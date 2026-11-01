import { describe, expect, test } from 'bun:test';
import { KEY_MAP } from '../types/keycode';
import {
  chordLabel,
  decodeChord,
  encodeChord,
  firmwareCodeLabel,
  getSupportedBaseKeys,
  isSupportedBase,
  modifierIdsFromMask,
  modifierMaskFromIds,
} from './keyChords';

const HID_A = 0x04;
const HID_Z = 0x1d;

describe('encodeChord', () => {
  test('plain base key with zero modifiers equals the existing KEY_MAP code', () => {
    expect(encodeChord({ modifiers: 0, base: HID_A })).toBe(KEY_MAP[0x41].fw);
    expect(encodeChord({ modifiers: 0, base: 0x2c })).toBe(KEY_MAP[0x20].fw); // Space
    expect(encodeChord({ modifiers: 0, base: 0x65 })).toBe(KEY_MAP[0x5d].fw); // App
  });

  test('single modifiers alone equal the existing KEY_MAP modifier codes', () => {
    const cases: Array<[number, Parameters<typeof modifierMaskFromIds>[0]]> = [
      [0xa2, ['leftCtrl']], [0xa0, ['leftShift']], [0xa4, ['leftAlt']], [0x5b, ['leftGui']],
      [0xa3, ['rightCtrl']], [0xa1, ['rightShift']], [0xa5, ['rightAlt']], [0x5c, ['rightGui']],
    ];
    for (const [vk, ids] of cases) {
      expect(encodeChord({ modifiers: modifierMaskFromIds(ids), base: null })).toBe(KEY_MAP[vk].fw);
    }
  });

  test('combined modifiers with a base key', () => {
    expect(encodeChord({ modifiers: modifierMaskFromIds(['leftCtrl']), base: HID_A })).toBe(0x010400);
    expect(encodeChord({ modifiers: modifierMaskFromIds(['leftCtrl', 'leftShift']), base: HID_Z })).toBe(0x031d00);
    // Matches captured RK macro codes
    expect(encodeChord({ modifiers: 0x01, base: 0x06 })).toBe(KEY_MAP[0xb9].fw); // Ctrl+C
    expect(encodeChord({ modifiers: 0x01, base: 0x1d })).toBe(KEY_MAP[0xc1].fw); // Ctrl+Z
  });

  test('left and right modifiers of the same kind produce distinct bits', () => {
    const left = encodeChord({ modifiers: modifierMaskFromIds(['leftAlt']), base: HID_A });
    const right = encodeChord({ modifiers: modifierMaskFromIds(['rightAlt']), base: HID_A });
    expect(left).toBe(0x040400);
    expect(right).toBe(0x400400);
    expect(left).not.toBe(right);
  });

  test('highest mask with the highest supported base stays unsigned', () => {
    const code = encodeChord({ modifiers: 0xff, base: 0x65 });
    expect(code).toBe(0xff6500);
    expect(code).toBeGreaterThan(0);
    expect(encodeChord({ modifiers: 0x80, base: null })).toBe(0x800000);
  });

  test('rejects invalid masks, bases and empty chords', () => {
    const bad = [
      { modifiers: 0x100, base: HID_A },
      { modifiers: -1, base: HID_A },
      { modifiers: 1.5, base: HID_A },
      { modifiers: Number.NaN, base: HID_A },
      { modifiers: 0, base: 0x03 },
      { modifiers: 0, base: 0x66 },
      { modifiers: 0x01, base: 0xb0 }, // Fn is not a composable base
      { modifiers: 0x01, base: 0x32 }, // unverified "Sleep?" capture
      { modifiers: 0x01, base: 0xe0 }, // HID modifier usage, not a regular base
      { modifiers: 0, base: 4.5 },
      { modifiers: 0, base: null },
    ];
    for (const chord of bad) {
      expect(() => encodeChord(chord)).toThrow(RangeError);
    }
  });
});

describe('decodeChord', () => {
  test('round-trips every supported base with a spread of masks', () => {
    for (const { hid } of getSupportedBaseKeys()) {
      for (const modifiers of [0x00, 0x01, 0x10, 0x0f, 0xf0, 0xa5, 0xff]) {
        const chord = { modifiers, base: hid };
        expect(decodeChord(encodeChord(chord))).toEqual(chord);
      }
    }
  });

  test('round-trips every modifier-only mask', () => {
    for (let modifiers = 1; modifiers <= 0xff; modifiers++) {
      const chord = { modifiers, base: null };
      expect(decodeChord(encodeChord(chord))).toEqual(chord);
    }
  });

  test('preserves special, media and Fn codes by refusing to decode them', () => {
    const preserved = [
      KEY_MAP[0xfa].fw, // Fn 0xb000
      KEY_MAP[0xd8].fw, // Sleep? 0x3200
      KEY_MAP[0xda].fw, // Unknown 0x8a00
      KEY_MAP[0xad].fw, // Mute 0x010000e2
      KEY_MAP[0x99].fw, // Calculator 0x01000192
      KEY_MAP[0x1001].fw, // Brightness Up
      0x06000100, // KB.ini placeholder fallback
    ];
    for (const code of preserved) {
      expect(decodeChord(code)).toBeNull();
    }
  });

  test('rejects zero, negative, fractional, nonzero low byte and out-of-range codes', () => {
    for (const code of [0, -1, 1024.5,0x0401, 0x1000000, 0xffffffff, Number.NaN, Infinity]) {
      expect(decodeChord(code)).toBeNull();
    }
  });
});

describe('modifier masks', () => {
  test('ids and masks convert both ways in display order', () => {
    expect(modifierIdsFromMask(0xff)).toEqual([
      'leftCtrl', 'rightCtrl', 'leftShift', 'rightShift', 'leftAlt', 'rightAlt', 'leftGui', 'rightGui',
    ]);
    expect(modifierMaskFromIds(modifierIdsFromMask(0x5a))).toBe(0x5a);
    expect(modifierIdsFromMask(0)).toEqual([]);
    expect(() => modifierIdsFromMask(0x100)).toThrow(RangeError);
  });
});

describe('labels', () => {
  test('Mac labels map Command to GUI and Option to Alt without changing bits', () => {
    const chord = { modifiers: modifierMaskFromIds(['leftGui', 'rightAlt']), base: HID_A };
    expect(chordLabel(chord, 'mac')).toBe('Right Option + Left Command + A');
    expect(chordLabel(chord, 'windows')).toBe('Right Alt + Left Win + A');
    expect(encodeChord(chord)).toBe(0x480400);
  });

  test('firmware code labels cover chords, preserved specials and unknown codes', () => {
    expect(firmwareCodeLabel(0x0400, 'windows')).toBe('A');
    expect(firmwareCodeLabel(0x030600, 'windows')).toBe('Left Ctrl + Left Shift + C');
    expect(firmwareCodeLabel(0x020000, 'mac')).toBe('Left Shift');
    expect(firmwareCodeLabel(0xb000, 'mac')).toBe('Fn');
    expect(firmwareCodeLabel(0x010000cd, 'windows')).toBe('Play/Pause');
    expect(firmwareCodeLabel(0x06000100, 'windows')).toBe('0x6000100');
    expect(firmwareCodeLabel(-1, 'windows')).toBe('Invalid code -1');
  });

  test('ISO and backslash bases have distinct labels', () => {
    const labels = new Map(getSupportedBaseKeys().map(({ hid, label }) => [hid, label]));
    expect(labels.get(0x31)).toBe('\\ |');
    expect(labels.get(0x64)).toBe('ISO \\ |');
    expect(isSupportedBase(0x2c)).toBe(true);
    expect(labels.get(0x2c)).toBe('Space');
  });
});
