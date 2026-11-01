import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  checkClassicReportShape,
  classicRequestFilters,
  classifyDevice,
  hasClassicConfigInterface,
  deriveCapabilities,
  type DeviceDescriptor,
} from '../constants/deviceCapabilities';
import {
  EVIDENCE_RECORDS,
  evidenceProblems,
  getFeatureEvidence,
  isVerifiedInFork,
  type EvidenceRecord,
} from '../constants/deviceEvidence';
import { HIDDeviceManager, IncompatibleDeviceError } from '../models/HIDDeviceManager';
import { UnsupportedKeyboardError } from '../errors/KludgeKnightErrors';
import type { KeyboardConfig } from '../types/keyboard';
import { parseKBIni } from './kbIniParser';

/*
 * Descriptor and data contracts for classic-driver classification and evidence.
 * Only external boundaries are faked: fetch (serves shipped public/rk files),
 * localStorage, and the WebHID API/device objects. The real 0055 config is used.
 */

const PUBLIC_DIR = new URL('../../public/', import.meta.url);
const realFetch = globalThis.fetch;
const LED_MANIFEST = JSON.stringify({ global: { rgb: {}, backlit: {}, eft: {} } });

let rk61: KeyboardConfig;

// ---- descriptor fixtures (shape of WebHID HIDCollectionInfo) ---------------------
const keyboardCollection: HIDCollectionInfo = {
  usagePage: 0x0001,
  usage: 0x0006,
  inputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 8 }] }],
};

function featureReport(reportId: number, payloadBytes: number): HIDReportInfo {
  // Split across two items to exercise summing, as real descriptors often do.
  return { reportId, items: [{ reportSize: 8, reportCount: 1 }, { reportSize: 8, reportCount: payloadBytes - 1 }] };
}

function configCollection(...featureReports: HIDReportInfo[]): HIDCollectionInfo {
  return { usagePage: 0x0001, usage: 0x0080, featureReports };
}

function descriptor(collections: HIDCollectionInfo[], productId = 0x0055, vendorId = 0x258a): DeviceDescriptor {
  return { vendorId, productId, collections };
}

/** Default classic signature (0001:0080 with feature 0x0A of 64 bytes); still accepted for every config. */
const RK61_USB = descriptor([keyboardCollection, configCollection(featureReport(0x0a, 64))]);

// ---- golden: collections Chrome WebHID actually exposed for the owner's 258A:0055 (2026-11-01) ----
const consumer: HIDCollectionInfo = { usagePage: 0x000c, usage: 0x0001, type: 1, featureReports: [], inputReports: [{ reportId: 0x02, items: [] }] };
function vendorCollection(reportId: number, reportCount: number): HIDCollectionInfo {
  return { usagePage: 0xff00, usage: 0x0001, type: 1, featureReports: [{ reportId, items: [{ reportSize: 8, reportCount }] }] };
}
const OBSERVED_0055_COLLECTIONS = [consumer, vendorCollection(0x05, 5), vendorCollection(0x0a, 64)];
const OBSERVED_0055 = descriptor(OBSERVED_0055_COLLECTIONS);

beforeAll(async () => {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const rel = url.slice(url.indexOf('rk/'));
    const file = Bun.file(new URL(rel, PUBLIC_DIR));
    return (await file.exists()) ? new Response(file) : new Response(null, { status: 404 });
  }) as typeof fetch;
  const parsed = await parseKBIni('0055', LED_MANIFEST);
  if (!parsed) throw new Error('0055 config failed to load');
  rk61 = parsed;
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('report shape', () => {
  test('owner RK61 USB descriptor matches the classic writer', () => {
    expect(checkClassicReportShape(RK61_USB)).toEqual({ ok: true });
  });

  test('a normal keyboard collection alone is insufficient', () => {
    const r = checkClassicReportShape(descriptor([keyboardCollection]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-config-interface');
  });

  test('config interface found when nested under another collection', () => {
    const nested = descriptor([{ usagePage: 0x000c, usage: 0x0001, children: [configCollection(featureReport(0x0a, 64))] }]);
    expect(checkClassicReportShape(nested).ok).toBe(true);
  });

  test('feature report 0A on a non-config collection does not count', () => {
    const r = checkClassicReportShape(
      descriptor([{ ...keyboardCollection, featureReports: [featureReport(0x0a, 64)] }, configCollection(featureReport(0x05, 64))])
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('missing-feature-report');
      expect(r.detail).toContain('0x5');
    }
  });

  test('config interface without any feature report is rejected', () => {
    const r = checkClassicReportShape(descriptor([configCollection()]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-feature-report');
  });

  test.each([32, 63, 65, 128])('feature report 0A of %i payload bytes is rejected', bytes => {
    const r = checkClassicReportShape(descriptor([configCollection(featureReport(0x0a, bytes))]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-report-size');
  });

  test('one matching 0A report among others suffices', () => {
    const d = descriptor([configCollection(featureReport(0x06, 8), featureReport(0x0a, 64))]);
    expect(checkClassicReportShape(d).ok).toBe(true);
  });

  test('wrong vendor is rejected even with the right shape', () => {
    const r = checkClassicReportShape(descriptor(RK61_USB.collections as HIDCollectionInfo[], 0x0055, 0x05ac));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-vendor');
  });
});

describe('observed 0055 WebHID signature (vendor FF00:0001)', () => {
  test('golden descriptor matches and classifies as classic with source-derived custom mode 14', () => {
    expect(checkClassicReportShape(OBSERVED_0055)).toEqual({ ok: true });
    expect(hasClassicConfigInterface(OBSERVED_0055)).toBe(true);
    expect(classifyDevice(OBSERVED_0055, rk61)).toEqual({
      supported: true,
      family: 'classic',
      pid: '0055',
      capabilities: { keymap: true, globalLighting: true, perKeyColor: true, customLightingMode: 14 },
    });
  });

  test('vendor collection with only feature 0x05 is rejected', () => {
    const r = checkClassicReportShape(descriptor([consumer, vendorCollection(0x05, 5)]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('missing-feature-report');
  });

  test.each([32, 63, 65])('vendor feature 0x0A of %i bytes is rejected', bytes => {
    const r = checkClassicReportShape(descriptor([consumer, vendorCollection(0x05, 5), vendorCollection(0x0a, bytes)]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('wrong-report-size');
  });

  test('consumer/keyboard collections alone are rejected', () => {
    const r = checkClassicReportShape(descriptor([consumer, keyboardCollection]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-config-interface');
  });

  test.each([0x0056, 0x02a6, 0x7fff])('same vendor signature on PID %p is not accepted', productId => {
    const d = descriptor(OBSERVED_0055_COLLECTIONS, productId);
    expect(hasClassicConfigInterface(d)).toBe(false);
    const c = classifyDevice(d, null);
    expect(c.supported).toBe(false);
    if (!c.supported) expect(c.reason).toBe('no-config-interface');
  });

  test('same signature from another vendor is rejected', () => {
    expect(checkClassicReportShape(descriptor(OBSERVED_0055_COLLECTIONS, 0x0055, 0x05ac)).ok).toBe(false);
    expect(hasClassicConfigInterface(descriptor(OBSERVED_0055_COLLECTIONS, 0x0055, 0x05ac))).toBe(false);
  });

  test('picker filters keep the default interface and scope the vendor interface to exact PID 0055', () => {
    const filters = classicRequestFilters();
    expect(filters).toContainEqual({ vendorId: 0x258a, usagePage: 0x0001, usage: 0x0080 });
    expect(filters).toContainEqual({ vendorId: 0x258a, productId: 0x0055, usagePage: 0xff00, usage: 0x0001 });
    // No vendor-defined filter may apply across PIDs.
    expect(filters.filter(f => f.usagePage === 0xff00 && f.productId === undefined)).toEqual([]);
  });

  test('every 0055 feature record keeps the observed WebHID descriptor as a source', () => {
    for (const feature of ['keymap', 'globalLighting', 'perKeyColor'] as const) {
      const e = getFeatureEvidence('0055', feature);
      expect(e?.sources.some(s => s.includes('WebHID') && s.includes('FF00:0001'))).toBe(true);
    }
  });
});

describe('classification', () => {
  test('RK61 0055 is classic with keymap, lighting and source-derived custom mode 14', () => {
    const c = classifyDevice(RK61_USB, rk61);
    expect(c).toEqual({
      supported: true,
      family: 'classic',
      pid: '0055',
      capabilities: { keymap: true, globalLighting: true, perKeyColor: true, customLightingMode: 14 },
    });
  });

  test('unknown PID with the right shape is rejected with guidance', () => {
    const c = classifyDevice(descriptor(RK61_USB.collections as HIDCollectionInfo[], 0x7fff), null);
    expect(c.supported).toBe(false);
    if (!c.supported) {
      expect(c.reason).toBe('unknown-pid');
      expect(c.pid).toBe('7fff');
      expect(c.guidance.length).toBeGreaterThan(0);
    }
  });

  test('a config for a different PID is not borrowed', () => {
    const c = classifyDevice(descriptor(RK61_USB.collections as HIDCollectionInfo[], 0x0056), rk61);
    expect(c.supported).toBe(false);
    if (!c.supported) expect(c.reason).toBe('unknown-pid');
  });

  test('config with no keys is rejected', () => {
    const c = classifyDevice(RK61_USB, { ...rk61, keys: [] });
    expect(c.supported).toBe(false);
    if (!c.supported) expect(c.reason).toBe('no-keys');
  });

  test('wrong report shape rejects even with a valid config', () => {
    const c = classifyDevice(descriptor([keyboardCollection, configCollection(featureReport(0x0a, 32))]), rk61);
    expect(c.supported).toBe(false);
    if (!c.supported) expect(c.reason).toBe('wrong-report-size');
  });

  test('official-web PID hint is included as a dated hint, not acceptance', () => {
    // 02a6 is in the February 2026 official-web snapshot; it has the wrong protocol here.
    const c = classifyDevice(descriptor([configCollection(featureReport(0x06, 64))], 0x02a6), null);
    expect(c.supported).toBe(false);
    if (!c.supported) expect(c.guidance).toContain('February 2026');
  });
});

describe('capabilities', () => {
  test('RGB board without variant metadata gets no custom mode', () => {
    const caps = deriveCapabilities({ ...rk61, pid: '9999' });
    expect(caps.globalLighting).toBe(true);
    expect(caps.perKeyColor).toBe(false);
    expect(caps.customLightingMode).toBeNull();
  });

  test('variant mode absent from the loaded modes is not assumed', () => {
    const caps = deriveCapabilities({ ...rk61, lightingModes: rk61.lightingModes.filter(m => m.index !== 14) });
    expect(caps.customLightingMode).toBeNull();
    expect(caps.perKeyColor).toBe(false);
  });

  test('non-RGB config never gets per-key color even with metadata', () => {
    const caps = deriveCapabilities({ ...rk61, rgb: false, lightingType: 'backlit' });
    expect(caps.perKeyColor).toBe(false);
  });

  test('no lighting modes means no global lighting', () => {
    const caps = deriveCapabilities({ ...rk61, lightEnabled: false, lightingModes: [], rgb: false, lightingType: 'none' });
    expect(caps).toEqual({ keymap: true, globalLighting: false, perKeyColor: false, customLightingMode: null });
  });
});

describe('evidence', () => {
  test('every shipped record satisfies the data contract', () => {
    for (const r of EVIDENCE_RECORDS) expect({ r, problems: evidenceProblems(r) }).toEqual({ r, problems: [] });
  });

  test('a source-derived or community-reported record is not verified in this fork', () => {
    const sourceOnly: EvidenceRecord = {
      pid: '0055',
      feature: 'globalLighting',
      level: 'source-derived',
      transport: 'usb',
      recordedOn: '2026-10-31',
      sources: ['KB.ini'],
    };
    expect(isVerifiedInFork('0055', 'globalLighting', 'usb', [sourceOnly])).toBe(false);
    const reported: EvidenceRecord = { ...sourceOnly, level: 'community-reported', observation: 'Works for a third party' };
    expect(isVerifiedInFork('0055', 'globalLighting', 'usb', [reported])).toBe(false);
  });

  test('unrecorded PID or transport has no evidence record', () => {
    expect(getFeatureEvidence('7fff', 'keymap')).toBeNull();
    expect(getFeatureEvidence('0055', 'keymap', 'bluetooth')).toBeNull();
  });

  test('verified record is per feature and per transport', () => {
    const verified: EvidenceRecord = {
      pid: '0055',
      feature: 'keymap',
      level: 'verified-fork',
      transport: 'usb',
      recordedOn: '2026-11-02',
      sources: ['S3 physical run'],
      observation: 'Remapped keys produced the expected events',
    };
    const sourceOnly: EvidenceRecord = { ...verified, feature: 'perKeyColor', level: 'source-derived', observation: undefined };
    const records = [sourceOnly, verified];
    expect(isVerifiedInFork('0055', 'keymap', 'usb', records)).toBe(true);
    expect(isVerifiedInFork('0055', 'perKeyColor', 'usb', records)).toBe(false);
    expect(isVerifiedInFork('0055', 'keymap', 'bluetooth', records)).toBe(false);
    expect(isVerifiedInFork('0056', 'keymap', 'usb', records)).toBe(false);
  });

  test('verified or community records without observation are invalid', () => {
    const base: EvidenceRecord = {
      pid: '0055',
      feature: 'perKeyColor',
      level: 'verified-fork',
      transport: 'usb',
      recordedOn: '2026-11-02',
      sources: ['S2 physical run'],
    };
    expect(evidenceProblems(base)).toContain('verified-fork evidence requires an observation');
    expect(evidenceProblems({ ...base, level: 'community-reported' })).toContain('community-reported evidence requires an observation');
  });

  test.each([
    ['2026-02-30', 'recordedOn must be a real YYYY-MM-DD date'],
    ['2026-11-1', 'recordedOn must be a real YYYY-MM-DD date'],
  ])('date %s is invalid', (recordedOn, problem) => {
    const r: EvidenceRecord = { pid: '0055', feature: 'keymap', level: 'source-derived', transport: 'usb', recordedOn, sources: ['x'] };
    expect(evidenceProblems(r)).toContain(problem);
  });

  test('uppercase PID or empty sources are invalid', () => {
    const r: EvidenceRecord = { pid: '00AB', feature: 'keymap', level: 'source-derived', transport: 'usb', recordedOn: '2026-10-31', sources: [] };
    expect(evidenceProblems(r)).toEqual(['pid must be 4 lowercase hex digits', 'at least one non-empty source is required']);
  });
});

// ---- manager: reject before open/construction ----------------------------------
class FakeHIDDevice {
  opened = false;
  openCalls = 0;
  serialNumber = '';
  vendorId = 0x258a;
  productName: string;
  collections: HIDCollectionInfo[];
  productId: number;
  constructor(productName: string, collections: HIDCollectionInfo[], productId = 0x0055) {
    this.productName = productName;
    this.collections = collections;
    this.productId = productId;
  }
  async open() {
    this.openCalls++;
    this.opened = true;
  }
  addEventListener() {}
  removeEventListener() {}
  async sendFeatureReport() {
    throw new Error('no writes expected in classification tests');
  }
}

describe('HIDDeviceManager', () => {
  let authorized: FakeHIDDevice[];
  let picked: FakeHIDDevice[];
  let requestOptions: HIDDeviceRequestOptions | undefined;
  const manager = HIDDeviceManager.getInstance();

  const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  beforeAll(() => {
    manager.setLedManifest(LED_MANIFEST);
  });

  afterAll(() => {
    for (const d of manager.getAllDevices()) manager.removeDevice(d.id);
    if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator);
  });

  beforeEach(() => {
    authorized = [];
    picked = [];
    const data = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        hid: {
          getDevices: async () => authorized,
          requestDevice: async (options: HIDDeviceRequestOptions) => {
            requestOptions = options;
            return picked;
          },
          addEventListener() {},
          removeEventListener() {},
        },
      },
      configurable: true,
      writable: true,
    });
    for (const d of manager.getAllDevices()) manager.removeDevice(d.id);
  });

  test('authorized scan opens the observed 0055 vendor-interface descriptor', async () => {
    const real = new FakeHIDDevice('RK61 observed', OBSERVED_0055_COLLECTIONS);
    authorized = [real];
    const devices = await manager.scanAuthorizedDevices();
    expect(devices.map(d => d.config.pid)).toEqual(['0055']);
    expect(real.openCalls).toBe(1);
    expect(manager.getCapabilities(devices[0].id)?.customLightingMode).toBe(14);
  });

  test('authorized scan skips the same vendor descriptor on another PID without opening', async () => {
    const other = new FakeHIDDevice('RK other', OBSERVED_0055_COLLECTIONS, 0x0056);
    authorized = [other];
    expect(await manager.scanAuthorizedDevices()).toEqual([]);
    expect(other.openCalls).toBe(0);
  });

  test('picker requests the exact-PID vendor filter and opens the observed descriptor', async () => {
    const real = new FakeHIDDevice('RK61 picked', OBSERVED_0055_COLLECTIONS);
    picked = [real];
    const device = await manager.requestDevice();
    expect(requestOptions?.filters).toContainEqual({ vendorId: 0x258a, productId: 0x0055, usagePage: 0xff00, usage: 0x0001 });
    expect(requestOptions?.filters).toContainEqual({ vendorId: 0x258a, usagePage: 0x0001, usage: 0x0080 });
    expect(device?.config.pid).toBe('0055');
    expect(real.openCalls).toBe(1);
  });

  test('config interface without report 0A is never opened or constructed', async () => {
    const wrong = new FakeHIDDevice('RK61 no-0A', [keyboardCollection, configCollection(featureReport(0x06, 64))]);
    authorized = [wrong];
    expect(await manager.scanAuthorizedDevices()).toEqual([]);
    expect(wrong.openCalls).toBe(0);
    expect(manager.getAllDevices()).toEqual([]);
  });

  test('picker rejection carries reason and guidance and stays an UnsupportedKeyboardError', async () => {
    picked = [new FakeHIDDevice('RK61 short', [configCollection(featureReport(0x0a, 32))])];
    const err = await manager.requestDevice().catch(e => e);
    expect(err).toBeInstanceOf(IncompatibleDeviceError);
    expect(err).toBeInstanceOf(UnsupportedKeyboardError);
    expect(err.reason).toBe('wrong-report-size');
    expect(err.guidance).toContain('No settings were sent');
    expect(picked[0].openCalls).toBe(0);
  });

  test('unknown PID with matching shape is rejected before open', async () => {
    const unknown = new FakeHIDDevice('RK unknown', RK61_USB.collections as HIDCollectionInfo[], 0x7ffe);
    picked = [unknown];
    const err = await manager.requestDevice().catch(e => e);
    expect(err).toBeInstanceOf(IncompatibleDeviceError);
    expect(err.reason).toBe('unknown-pid');
    expect(unknown.openCalls).toBe(0);
  });

  test('picker prefers the interface with the classic shape and records capabilities', async () => {
    const other = new FakeHIDDevice('RK61 other-if', [configCollection(featureReport(0x06, 8))]);
    const good = new FakeHIDDevice('RK61 config-if', RK61_USB.collections as HIDCollectionInfo[]);
    picked = [other, good];
    const device = await manager.requestDevice();
    expect(device?.config.pid).toBe('0055');
    expect(good.openCalls).toBe(1);
    expect(other.openCalls).toBe(0);
    expect(manager.getCapabilities(device!.id)).toEqual({ keymap: true, globalLighting: true, perKeyColor: true, customLightingMode: 14 });
    manager.removeDevice(device!.id);
    expect(manager.getCapabilities(device!.id)).toBeUndefined();
  });
});
