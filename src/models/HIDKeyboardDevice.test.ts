import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { HIDKeyboardDevice } from './HIDKeyboardDevice';
import { DemoKeyboardDevice } from './DemoKeyboardDevice';
import { InvalidApplyRequestError, DeviceDisconnectedError } from './KeyboardDevice';
import type { StandardLightingSettings } from './LightingCodec';
import type { KeyboardConfig } from '../types/keyboard';
import { parseKBIni } from '../utils/kbIniParser';
import { LightingNotSupportedError, RGBNotSupportedError } from '../errors/KludgeKnightErrors';

/*
 * Contract tests for batch apply on the real model + translator + codecs.
 * Only external boundaries are faked: fetch (to read the shipped 0055 config
 * from public/), localStorage, and the WebHID peripheral.
 */

const PUBLIC_DIR = new URL('../../public/', import.meta.url);
const realFetch = globalThis.fetch;

// ---- fake localStorage --------------------------------------------------------
class FakeStorage {
  data = new Map<string, string>();
  failWrites = false;
  writes = 0;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.writes++;
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}
let storage: FakeStorage;

// ---- fake WebHID peripheral ----------------------------------------------------
interface SentReport {
  reportId: number;
  data: Uint8Array;
}
class FakeHID {
  vendorId = 0x258a;
  productId = 0x0055;
  productName = 'RK61 test';
  serialNumber = '';
  sent: SentReport[] = [];
  attempts = 0;
  /** 1-based attempt number that rejects, or 0 for none. */
  failOnAttempt = 0;
  delayMs = 0;
  log: string[] = [];
  addEventListener() {}
  removeEventListener() {}
  async sendFeatureReport(reportId: number, data: BufferSource) {
    this.attempts++;
    const bytes = new Uint8Array(data as ArrayBufferLike);
    this.log.push(`${bytes[0]}/${bytes[1]}`);
    if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
    if (this.attempts === this.failOnAttempt) throw new DOMException('Failed to write the feature report.', 'NotAllowedError');
    this.sent.push({ reportId, data: bytes });
  }
}

let config: KeyboardConfig;
let hid: FakeHID;
let device: HIDKeyboardDevice;
let notifications: number;

const STORAGE_KEY = () => `kludgeknight_profile_${device.id}`;
const CUSTOM_MODE = 14;

function makeDevice() {
  const d = new HIDKeyboardDevice(hid as unknown as HIDDevice, config);
  d.notify = () => notifications++;
  return d;
}

function lighting(overrides: Partial<StandardLightingSettings> = {}): StandardLightingSettings {
  return {
    modeIndex: 2,
    speed: 1,
    brightness: 5,
    color: { r: 0, g: 12, b: 255 },
    randomColor: false,
    sleep: 2,
    ...overrides,
  };
}

function allOff(): Record<number, { r: number; g: number; b: number }> {
  return Object.fromEntries(config.keys.map(k => [k.bIndex, { r: 0, g: 0, b: 0 }]));
}

/** Rebuild the 585-byte keymap space from nine sent reports (data excludes report ID). */
function keymapSpace(reports: SentReport[]): Uint8Array {
  const out: number[] = [];
  reports.forEach((r, i) => out.push(...r.data.slice(i === 0 ? 4 : 2)));
  return Uint8Array.from(out);
}

function readKey(space: Uint8Array, bIndex: number): number {
  const o = bIndex * 4;
  return ((space[o] << 24) | (space[o + 1] << 16) | (space[o + 2] << 8) | space[o + 3]) >>> 0;
}

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const rel = url.slice(url.indexOf('rk/'));
    const file = Bun.file(new URL(rel, PUBLIC_DIR));
    return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
  }) as typeof fetch;
  const manifest = JSON.stringify({ global: { rgb: {}, backlit: {}, eft: {} } });
  const parsed = await parseKBIni('0055', manifest);
  if (!parsed) throw new Error('0055 config failed to load');
  config = parsed;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  hid = new FakeHID();
  notifications = 0;
  device = makeDevice();
});

describe('0055 fixture', () => {
  test('is an RGB board with custom mode 14 and 61+ keys', () => {
    expect(config.rgb).toBe(true);
    expect(config.lightingModes.some(m => m.index === CUSTOM_MODE)).toBe(true);
    expect(config.keys.length).toBeGreaterThanOrEqual(61);
  });
});

describe('applyMappings', () => {
  test('sends exactly nine ordered reports, keeps factory codes, then publishes and persists', async () => {
    const [k1, k2, untouched] = config.keys;
    const chord = 0x010000 | 0x0400; // left Ctrl + A
    const result = await device.applyMappings(new Map([[k1.bIndex, chord], [k2.bIndex, 0xffffffff]]));

    expect(result).toEqual({ persisted: true });
    expect(hid.sent).toHaveLength(9);
    hid.sent.forEach((r, i) => {
      expect(r.reportId).toBe(0x0a);
      expect(r.data).toHaveLength(64);
      expect(r.data[0]).toBe(9);
      expect(r.data[1]).toBe(i + 1);
    });

    const space = keymapSpace(hid.sent);
    expect(readKey(space, k1.bIndex)).toBe(chord);
    expect(readKey(space, k2.bIndex)).toBe(0xffffffff);
    expect(readKey(space, untouched.bIndex)).toBe(untouched.keyInfo.fw >>> 0);
    for (const key of config.keys.slice(2)) {
      expect(readKey(space, key.bIndex)).toBe(key.keyInfo.fw >>> 0);
    }

    expect(device.getMapping(k1.bIndex)).toBe(chord);
    expect(device.hasMapping(untouched.bIndex)).toBe(false);
    expect(device.writeState).toBe('idle');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY())!);
    expect(saved.version).toBe(3);
    expect(saved.mappings).toEqual([[k1.bIndex, chord], [k2.bIndex, 0xffffffff]]);
  });

  test('snapshots the request so later caller edits do not change what is sent', async () => {
    const k = config.keys[0];
    const draft = new Map([[k.bIndex, 0x0400]]);
    const pending = device.applyMappings(draft);
    draft.set(k.bIndex, 0x0500);
    draft.set(config.keys[1].bIndex, 0x0600);
    await pending;
    expect(device.mappings).toEqual(new Map([[k.bIndex, 0x0400]]));
  });

  test.each([
    ['unknown key index', () => new Map([[9999, 0x0400]])],
    ['firmware code above 32 bits', () => new Map([[config.keys[0].bIndex, 0x100000000]])],
    ['negative firmware code', () => new Map([[config.keys[0].bIndex, -1]])],
    ['fractional firmware code', () => new Map([[config.keys[0].bIndex, 1.5]])],
  ])('rejects %s before any transmission', async (_label, build) => {
    await expect(device.applyMappings(build())).rejects.toBeInstanceOf(InvalidApplyRequestError);
    expect(hid.attempts).toBe(0);
    expect(storage.writes).toBe(0);
    expect(device.writeState).toBe('idle');
  });

  test('rejects when disconnected without transmitting', async () => {
    device.connected = false;
    await expect(device.applyMappings(new Map())).rejects.toBeInstanceOf(DeviceDisconnectedError);
    expect(hid.attempts).toBe(0);
  });

  test('failure mid-transfer keeps last-applied state, marks uncertain and does not retry', async () => {
    const k = config.keys[0];
    await device.applyMappings(new Map([[k.bIndex, 0x0400]]));
    const savedBefore = storage.getItem(STORAGE_KEY());
    hid.attempts = 0;
    hid.failOnAttempt = 4;

    await expect(device.applyMappings(new Map([[k.bIndex, 0x0500]]))).rejects.toThrow('Failed to write');
    expect(hid.attempts).toBe(4);
    expect(device.getMapping(k.bIndex)).toBe(0x0400);
    expect(storage.getItem(STORAGE_KEY())).toBe(savedBefore);
    expect(device.writeState).toBe('uncertain');

    // A later full apply of the same area succeeds and clears uncertainty.
    hid.failOnAttempt = 0;
    await device.applyMappings(new Map([[k.bIndex, 0x0500]]));
    expect(device.writeState).toBe('idle');
    expect(device.getMapping(k.bIndex)).toBe(0x0500);
  });

  test('failure on the first report is still uncertain (the write was attempted)', async () => {
    hid.failOnAttempt = 1;
    await expect(device.applyMappings(new Map())).rejects.toThrow();
    expect(device.writeState).toBe('uncertain');
  });

  test('storage failure after a successful transfer returns persisted:false and keeps applied state', async () => {
    storage.failWrites = true;
    const k = config.keys[0];
    const result = await device.applyMappings(new Map([[k.bIndex, 0x0400]]));
    expect(result).toEqual({ persisted: false });
    expect(hid.sent).toHaveLength(9);
    expect(device.getMapping(k.bIndex)).toBe(0x0400);
    expect(device.writeState).toBe('idle');
  });

  test('publishes applied state before the final notify', async () => {
    const k = config.keys[0];
    const seen: Array<number | undefined> = [];
    device.notify = () => seen.push(device.getMapping(k.bIndex));
    await device.applyMappings(new Map([[k.bIndex, 0x0400]]));
    expect(seen.at(-1)).toBe(0x0400);
    expect(seen.slice(0, -1).every(v => v === undefined)).toBe(true);
  });
});

describe('applyLighting', () => {
  test('standard mode sends one global report and keeps saved keymap', async () => {
    const k = config.keys[0];
    await device.applyMappings(new Map([[k.bIndex, 0x0400]]));
    hid.sent = [];

    const result = await device.applyLighting(lighting());
    expect(result).toEqual({ persisted: true });
    expect(hid.sent).toHaveLength(1);
    const d = hid.sent[0].data;
    expect([d[0], d[1], d[2], d[3]]).toEqual([1, 1, 0x02, 0x29]);
    expect([d[4], d[6], d[7], d[8], d[9], d[10], d[11], d[12]]).toEqual([2, 1, 5, 0, 12, 255, 0, 2]);

    const saved = JSON.parse(storage.getItem(STORAGE_KEY())!);
    expect(saved.mappings).toEqual([[k.bIndex, 0x0400]]);
    expect(saved.lightingSettings.modeIndex).toBe(2);
  });

  test('custom mode sends global then all seven color packets; unlisted keys are off', async () => {
    const [a, b, off] = config.keys;
    const colors = { [a.bIndex]: { r: 0, g: 0, b: 255 }, [b.bIndex]: { r: 255, g: 255, b: 255 } };
    await device.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), colors);

    expect(hid.sent).toHaveLength(8);
    expect(hid.sent[0].data[3]).toBe(0x29);
    expect(hid.sent[0].data[4]).toBe(CUSTOM_MODE);
    const rgb = hid.sent.slice(1);
    rgb.forEach((r, i) => {
      expect(r.data[0]).toBe(7);
      expect(r.data[1]).toBe(i + 1);
    });
    const space: number[] = [];
    rgb.forEach((r, i) => space.push(...r.data.slice(i === 0 ? 5 : 2)));
    expect(space.slice(a.bIndex * 3, a.bIndex * 3 + 3)).toEqual([0, 0, 255]);
    expect(space.slice(b.bIndex * 3, b.bIndex * 3 + 3)).toEqual([255, 255, 255]);
    expect(space.slice(off.bIndex * 3, off.bIndex * 3 + 3)).toEqual([0, 0, 0]);

    // Applied state is the complete map: every physical key explicit, unlisted keys off.
    const expected = allOff();
    Object.assign(expected, colors);
    expect(device.perKeyColors).toEqual(expected);
    const reloaded = makeDevice();
    expect(reloaded.perKeyColors).toEqual(expected);
    expect(reloaded.lightingSettings?.modeIndex).toBe(CUSTOM_MODE);
  });

  test.each([
    ['mode not in config', () => [lighting({ modeIndex: 99 })]],
    ['brightness above 5', () => [lighting({ brightness: 6 })]],
    ['speed 0', () => [lighting({ speed: 0 })]],
    ['sleep 6', () => [lighting({ sleep: 6 })]],
    ['color channel 256', () => [lighting({ color: { r: 256, g: 0, b: 0 } })]],
    ['per-key color for unknown key', () => [lighting({ modeIndex: CUSTOM_MODE }), { 9999: { r: 1, g: 2, b: 3 } }]],
    ['per-key fractional channel', () => [lighting({ modeIndex: CUSTOM_MODE }), { [config.keys[0].bIndex]: { r: 1.5, g: 0, b: 0 } }]],
    ['per-key colors with a standard mode', () => [lighting({ modeIndex: 2 }), { [config.keys[0].bIndex]: { r: 1, g: 2, b: 3 } }]],
    ['custom mode without a color map', () => [lighting({ modeIndex: CUSTOM_MODE })]],
  ] as const)('rejects %s before any transmission', async (_label, build) => {
    const [s, c] = build() as [StandardLightingSettings, Record<number, { r: number; g: number; b: number }>?];
    await expect(device.applyLighting(s, c)).rejects.toBeInstanceOf(InvalidApplyRequestError);
    expect(hid.attempts).toBe(0);
    expect(storage.writes).toBe(0);
  });

  test('golden 0055 wire order: logical RGB is sent as G,R,B per key (owner physical observation)', async () => {
    // Observed on the owner's RK61: intended Q red showed green, W green showed red,
    // E blue showed blue; all 61 keys logical red showed all green.
    const byLabel = (label: string) => config.keys.find(k => k.keyInfo.label === label)!;
    const [q, w, e] = ['Q', 'W', 'E'].map(byLabel);
    const red = { r: 255, g: 0, b: 0 };
    const colors = { ...Object.fromEntries(config.keys.map(k => [k.bIndex, red])) };
    colors[w.bIndex] = { r: 0, g: 255, b: 0 };
    colors[e.bIndex] = { r: 0, g: 0, b: 255 };
    await device.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), colors);

    expect(hid.sent).toHaveLength(8);
    const space: number[] = [];
    hid.sent.slice(1).forEach((r, i) => space.push(...r.data.slice(i === 0 ? 5 : 2)));
    const wire = (bIndex: number) => space.slice(bIndex * 3, bIndex * 3 + 3);
    expect(wire(q.bIndex)).toEqual([0, 255, 0]);
    expect(wire(w.bIndex)).toEqual([255, 0, 0]);
    expect(wire(e.bIndex)).toEqual([0, 0, 255]);
    for (const key of config.keys) {
      if (key === w || key === e) continue;
      expect(wire(key.bIndex)).toEqual([0, 255, 0]);
    }

    // App and storage stay in logical RGB.
    expect(device.perKeyColors[q.bIndex]).toEqual(red);
    expect(makeDevice().perKeyColors[w.bIndex]).toEqual({ r: 0, g: 255, b: 0 });
    // Global lighting color is still R,G,B (no evidence of a swap there).
    const g = hid.sent[0].data;
    expect([g[8], g[9], g[10]]).toEqual([0, 12, 255]);
  });

  test('failure inside the color packets leaves applied lighting and colors unchanged', async () => {
    const before = device.lightingSettings;
    hid.failOnAttempt = 5;
    await expect(
      device.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), { [config.keys[0].bIndex]: { r: 1, g: 2, b: 3 } })
    ).rejects.toThrow();
    expect(hid.attempts).toBe(5);
    expect(device.lightingSettings).toBe(before);
    expect(device.perKeyColors).toEqual({});
    expect(device.writeState).toBe('uncertain');
    expect(storage.writes).toBe(0);
  });
});

describe('per-key color capability gating (P3 metadata)', () => {
  const someColor = () => ({ [config.keys[0].bIndex]: { r: 1, g: 2, b: 3 } });
  const deviceFor = (cfg: KeyboardConfig) => new HIDKeyboardDevice(hid as unknown as HIDDevice, cfg);

  test('an RGB variant without established custom mode rejects every color path before writes', async () => {
    // Same RGB layout and a mode 14 entry, but no explicit variant metadata.
    const unestablished = deviceFor({ ...config, pid: 'FFFF' });
    await expect(unestablished.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), someColor())).rejects.toBeInstanceOf(RGBNotSupportedError);
    await expect(unestablished.setPerKeyColors(someColor())).rejects.toBeInstanceOf(RGBNotSupportedError);
    await expect(unestablished.setKeyColor(config.keys[0].bIndex, 1, 2, 3)).rejects.toBeInstanceOf(RGBNotSupportedError);
    await expect(unestablished.clearKeyColor(config.keys[0].bIndex)).rejects.toBeInstanceOf(RGBNotSupportedError);
    expect(hid.attempts).toBe(0);
    expect(storage.writes).toBe(0);
  });

  test('an unestablished variant still gets exactly one global report for a standard apply (no guessed custom mode)', async () => {
    const unestablished = deviceFor({ ...config, pid: 'FFFF' });
    await unestablished.applyLighting(lighting({ modeIndex: CUSTOM_MODE }));
    expect(hid.sent).toHaveLength(1);
    expect(hid.sent[0].data[3]).toBe(0x29);
  });

  test('a board without lighting rejects lighting before writes', async () => {
    const dark = deviceFor({ ...config, pid: 'FFFE', lightEnabled: false, rgb: false, lightingModes: [] });
    await expect(dark.applyLighting(lighting())).rejects.toBeInstanceOf(LightingNotSupportedError);
    await expect(dark.applyLighting(lighting(), someColor())).rejects.toBeInstanceOf(LightingNotSupportedError);
    await expect(dark.setLighting(lighting())).rejects.toBeInstanceOf(LightingNotSupportedError);
    expect(hid.attempts).toBe(0);
  });

  test('an empty color map in custom mode sends global + all seven packets with every key off', async () => {
    await device.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), {});
    expect(hid.sent).toHaveLength(8);
    expect(hid.sent.slice(1).every(r => r.data.slice(r.data[1] === 1 ? 5 : 2).every(b => b === 0))).toBe(true);
    expect(device.perKeyColors).toEqual(allOff());
  });

  test.each([9999, -1, 1.5])('clearKeyColor(%p) rejects an index outside the layout with zero writes (real and demo)', async bIndex => {
    await expect(device.clearKeyColor(bIndex)).rejects.toBeInstanceOf(InvalidApplyRequestError);
    await expect(new DemoKeyboardDevice(config).clearKeyColor(bIndex)).rejects.toBeInstanceOf(InvalidApplyRequestError);
    expect(hid.attempts).toBe(0);
    expect(storage.writes).toBe(0);
  });

  test('legacy setPerKeyColors on the established variant sends exactly the seven color packets', async () => {
    await device.setPerKeyColors(someColor());
    expect(hid.sent).toHaveLength(7);
    hid.sent.forEach((r, i) => expect([r.data[0], r.data[1]]).toEqual([7, i + 1]));
  });
});

describe('queue ordering', () => {
  test('a keymap apply queued during a lighting transaction never interleaves', async () => {
    hid.delayMs = 2;
    const lightingDone = device.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), {});
    const keymapDone = device.applyMappings(new Map([[config.keys[0].bIndex, 0x0400]]));
    await Promise.all([lightingDone, keymapDone]);

    // count byte / packet index for each report, in send order
    expect(hid.log).toEqual([
      '1/1',
      ...Array.from({ length: 7 }, (_, i) => `7/${i + 1}`),
      ...Array.from({ length: 9 }, (_, i) => `9/${i + 1}`),
    ]);
  });

  test('legacy single-key mutators compose against applied state at execution time', async () => {
    const [a, b] = config.keys;
    await Promise.all([device.setMapping(a.bIndex, 0x0400), device.setMapping(b.bIndex, 0x0500)]);
    expect(device.mappings).toEqual(new Map([[a.bIndex, 0x0400], [b.bIndex, 0x0500]]));
    const lastNine = keymapSpace(hid.sent.slice(-9));
    expect(readKey(lastNine, a.bIndex)).toBe(0x0400);
    expect(readKey(lastNine, b.bIndex)).toBe(0x0500);
  });

  test('a failed apply does not block later queued work', async () => {
    hid.failOnAttempt = 1;
    const failed = device.applyMappings(new Map());
    const next = device.applyLighting(lighting());
    await expect(failed).rejects.toThrow();
    await expect(next).resolves.toEqual({ persisted: true });
    // keymap area remains uncertain even though lighting succeeded
    expect(device.writeState).toBe('uncertain');
  });
});

describe('saved state on connect', () => {
  test('drops saved entries that are not in the connected configuration', () => {
    const k = config.keys[0];
    storage.data.set(
      `kludgeknight_profile_${device.id}`,
      JSON.stringify({
        version: 3,
        mappings: [[k.bIndex, 0x0400], [9999, 0x0500]],
        lightingSettings: lighting({ modeIndex: 99 }),
        perKeyColors: [[k.bIndex, 1, 2, 3], [9999, 4, 5, 6]],
      })
    );
    const reloaded = makeDevice();
    expect(reloaded.mappings).toEqual(new Map([[k.bIndex, 0x0400]]));
    expect(reloaded.perKeyColors).toEqual({ [k.bIndex]: { r: 1, g: 2, b: 3 } });
    expect(reloaded.lightingSettings?.modeIndex).toBe(config.lightingModes[0].index);
    expect(storage.writes).toBe(0);
  });
});

describe('DemoKeyboardDevice parity', () => {
  test('applies with the same validation, never persists or touches storage', async () => {
    const demo = new DemoKeyboardDevice(config);
    const k = config.keys[0];
    await expect(demo.applyMappings(new Map([[9999, 1]]))).rejects.toBeInstanceOf(InvalidApplyRequestError);
    await expect(demo.applyMappings(new Map([[k.bIndex, 0x0400]]))).resolves.toEqual({ persisted: false });
    await expect(
      demo.applyLighting(lighting({ modeIndex: CUSTOM_MODE }), { [k.bIndex]: { r: 1, g: 2, b: 3 } })
    ).resolves.toEqual({ persisted: false });
    expect(demo.getMapping(k.bIndex)).toBe(0x0400);
    expect(demo.perKeyColors).toEqual({ ...allOff(), [k.bIndex]: { r: 1, g: 2, b: 3 } });
    await expect(demo.applyLighting(lighting(), {})).rejects.toBeInstanceOf(InvalidApplyRequestError);
    expect(demo.writeState).toBe('idle');
    expect(storage.writes).toBe(0);
  });
});
