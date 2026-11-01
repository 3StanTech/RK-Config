import { beforeEach, describe, expect, test } from 'bun:test';
import { clearProfile, loadFullProfile, saveProfile } from './profileStorage';
import type { KeyboardConfig } from '../types/keyboard';
import type { StandardLightingSettings } from '../models/LightingCodec';

/*
 * Storage contract: existing-format reads, version 3 writes, bounded validation,
 * config filtering and quota failure. Only localStorage (the browser API) is faked.
 */

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

const ID = '9610-85-RK61';
const KEY = `kludgeknight_profile_${ID}`;
let storage: FakeStorage;

const settings: StandardLightingSettings = {
  modeIndex: 2,
  speed: 1,
  brightness: 5,
  color: { r: 0, g: 12, b: 255 },
  randomColor: false,
  sleep: 2,
};

/** Minimal config shape: only the fields filtering reads. */
const config = {
  name: 'RK61',
  keys: [{ bIndex: 0 }, { bIndex: 1 }, { bIndex: 20 }],
  lightEnabled: true,
  rgb: true,
  lightingModes: [{ index: 2 }, { index: 14 }],
} as unknown as KeyboardConfig;

function stored() {
  return JSON.parse(storage.data.get(KEY)!);
}

beforeEach(() => {
  storage = new FakeStorage();
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
});

describe('reading existing formats', () => {
  test('legacy bare array of mappings', () => {
    storage.data.set(KEY, JSON.stringify([[0, 0x0400], [20, 0x010400]]));
    const p = loadFullProfile(ID);
    expect(p.mappings).toEqual(new Map([[0, 0x0400], [20, 0x010400]]));
    expect(p.lightingSettings).toBeNull();
    expect(p.perKeyColors).toBeNull();
  });

  test('version 2 with mappings and lighting', () => {
    storage.data.set(KEY, JSON.stringify({ version: 2, mappings: [[1, 0x0500]], lightingSettings: settings }));
    const p = loadFullProfile(ID);
    expect(p.mappings).toEqual(new Map([[1, 0x0500]]));
    expect(p.lightingSettings).toEqual(settings);
    expect(p.perKeyColors).toBeNull();
  });

  test('version 2 lighting-only (written by the old lighting path)', () => {
    storage.data.set(KEY, JSON.stringify({ version: 2, lightingSettings: settings }));
    const p = loadFullProfile(ID);
    expect(p.mappings).toBeNull();
    expect(p.lightingSettings).toEqual(settings);
  });

  test('missing key yields empty values', () => {
    expect(loadFullProfile(ID)).toEqual({ mappings: null, lightingSettings: null, perKeyColors: null });
  });
});

describe('version 3 writes', () => {
  test('round-trips per-key colors and upgrades older data in place', () => {
    storage.data.set(KEY, JSON.stringify([[0, 0x0400]]));
    expect(saveProfile(ID, { lightingSettings: settings, perKeyColors: { 1: { r: 0, g: 0, b: 255 } } })).toBe(true);

    expect(stored()).toEqual({
      version: 3,
      mappings: [[0, 0x0400]],
      lightingSettings: settings,
      perKeyColors: [[1, 0, 0, 255]],
    });
    const p = loadFullProfile(ID);
    expect(p.perKeyColors).toEqual({ 1: { r: 0, g: 0, b: 255 } });
    expect(p.mappings).toEqual(new Map([[0, 0x0400]]));
  });

  test('saving one area preserves the other area', () => {
    saveProfile(ID, { lightingSettings: settings, perKeyColors: { 0: { r: 1, g: 2, b: 3 } } });
    saveProfile(ID, { mappings: new Map([[20, 0x0600]]) });
    const p = loadFullProfile(ID);
    expect(p.mappings).toEqual(new Map([[20, 0x0600]]));
    expect(p.lightingSettings).toEqual(settings);
    expect(p.perKeyColors).toEqual({ 0: { r: 1, g: 2, b: 3 } });
  });

  test('an empty keymap is saved as an explicit empty list', () => {
    saveProfile(ID, { mappings: new Map([[0, 0x0400]]) });
    saveProfile(ID, { mappings: new Map() });
    expect(loadFullProfile(ID).mappings).toEqual(new Map());
  });

  test('quota failure returns false and leaves stored data unchanged', () => {
    saveProfile(ID, { mappings: new Map([[0, 0x0400]]) });
    const before = storage.data.get(KEY);
    storage.failWrites = true;
    expect(saveProfile(ID, { mappings: new Map([[0, 0x0500]]) })).toBe(false);
    expect(storage.data.get(KEY)).toBe(before);
  });
});

describe('bounded validation (corrupt or unsupported data yields defaults and no write)', () => {
  test.each([
    ['unparseable JSON', '{not json'],
    ['unsupported future version', JSON.stringify({ version: 4, mappings: [[0, 0x0400]] })],
    ['color channel above 255', JSON.stringify({ version: 3, perKeyColors: [[0, 256, 0, 0]] })],
    ['fractional color channel', JSON.stringify({ version: 3, perKeyColors: [[0, 1.5, 0, 0]] })],
    ['firmware code above 32 bits', JSON.stringify({ version: 3, mappings: [[0, 0x100000000]] })],
    ['negative key index', JSON.stringify([[-1, 0x0400]])],
    ['brightness out of range', JSON.stringify({ version: 2, lightingSettings: { ...settings, brightness: 9 } })],
    ['string mode index', JSON.stringify({ version: 2, lightingSettings: { ...settings, modeIndex: '2' } })],
  ])('%s', (_label, raw) => {
    storage.data.set(KEY, raw);
    expect(loadFullProfile(ID, config)).toEqual({ mappings: null, lightingSettings: null, perKeyColors: null });
    expect(storage.writes).toBe(0);
    expect(storage.data.get(KEY)).toBe(raw);
  });
});

describe('filtering against the connected configuration', () => {
  test('drops unknown keys and unknown lighting modes', () => {
    storage.data.set(
      KEY,
      JSON.stringify({
        version: 3,
        mappings: [[0, 0x0400], [99, 0x0500]],
        lightingSettings: { ...settings, modeIndex: 7 },
        perKeyColors: [[20, 9, 9, 9], [99, 1, 1, 1]],
      })
    );
    const p = loadFullProfile(ID, config);
    expect(p.mappings).toEqual(new Map([[0, 0x0400]]));
    expect(p.lightingSettings).toBeNull();
    expect(p.perKeyColors).toEqual({ 20: { r: 9, g: 9, b: 9 } });
    expect(storage.writes).toBe(0);
  });

  test('ignores saved colors on a non-RGB configuration', () => {
    storage.data.set(KEY, JSON.stringify({ version: 3, perKeyColors: [[0, 1, 2, 3]] }));
    const p = loadFullProfile(ID, { ...config, rgb: false });
    expect(p.perKeyColors).toBeNull();
  });
});

test('clearProfile removes the saved record', () => {
  saveProfile(ID, { mappings: new Map([[0, 0x0400]]) });
  clearProfile(ID);
  expect(storage.data.has(KEY)).toBe(false);
});
