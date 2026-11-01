import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import ini from 'ini';
import { parseVK } from '../types/keycode';
import { decodeKBIni } from './keyboardImages';
import type { Key } from '../types/keyboard';
import {
  BLUE,
  CYAN,
  OFF,
  PURPLE,
  WHITE,
  clearKeys,
  columnsPalette,
  fillKeys,
  geometricColumns,
  wasdPalette,
} from './lightingPalettes';

/*
 * Golden examples use the shipped RK61 (PID 0055) KB.ini: 61 keys, sparse
 * bIndex slots 1..83 laid out column-major, staggered rows.
 */

function load0055(): { keys: Key[] } {
  const path = join(import.meta.dir, '../../public/rk/Dev/0055/KB.ini');
  const parsed = ini.parse(decodeKBIni(readFileSync(path)));
  const keys: Key[] = [];
  for (const [name, value] of Object.entries(parsed.KEY as Record<string, string>)) {
    if (!name.startsWith('K')) continue;
    const p = value.split(',').map(s => s.trim());
    keys.push({
      rect: [+p[0], +p[1], +p[2], +p[3]],
      keyInfo: parseVK(p[5], p[6])!,
      bIndex: parseInt(p[7]),
    });
  }
  return { keys };
}

const rk61 = load0055();
/** Symbol keys by their Windows VK code (KB.ini source identity); others by printed label. */
const VK: Record<string, number> = {
  '-': 0xbd, '=': 0xbb, '[': 0xdb, ']': 0xdd, '\\': 0xdc,
  ';': 0xba, "'": 0xde, ',': 0xbc, '.': 0xbe, '/': 0xbf,
};
const byLabel = (label: string) =>
  rk61.keys.find(k => (label in VK ? k.keyInfo.vk === VK[label] : k.keyInfo.label === label))!.bIndex;
const C = 'C';
const P = 'P';
function code(color: { r: number; g: number; b: number }) {
  if (color.r === CYAN.r && color.g === CYAN.g && color.b === CYAN.b) return C;
  if (color.r === PURPLE.r && color.g === PURPLE.g && color.b === PURPLE.b) return P;
  return '?';
}

function key(bIndex: number, vk: number, left: number, top = 0): Key {
  return {
    bIndex,
    keyInfo: parseVK(vk.toString(16))!,
    rect: [left, top, left + 30, top + 30],
  };
}

test('fixture is the real 0055 layout with sparse slots', () => {
  expect(rk61.keys).toHaveLength(61);
  expect(byLabel('W')).toBe(14);
  expect(Math.max(...rk61.keys.map(k => k.bIndex))).toBe(83);
});

describe('WASD preset on 0055', () => {
  const colors = wasdPalette(rk61);

  test('covers exactly the 61 physical bIndex slots, none by array position', () => {
    expect(Object.keys(colors).map(Number).sort((a, b) => a - b)).toEqual(
      rk61.keys.map(k => k.bIndex).sort((a, b) => a - b)
    );
    expect(colors[0]).toBeUndefined(); // slot 0 is not a physical key on 0055
  });

  test('W/A/S/D slots 14/9/15/21 are blue, everything else white', () => {
    expect([byLabel('W'), byLabel('A'), byLabel('S'), byLabel('D')]).toEqual([14, 9, 15, 21]);
    for (const k of rk61.keys) {
      const expected = [14, 9, 15, 21].includes(k.bIndex) ? BLUE : WHITE;
      expect(colors[k.bIndex]).toEqual(expected);
    }
  });

  test('custom colors are honored', () => {
    const red = { r: 255, g: 0, b: 0 };
    const out = wasdPalette(rk61, red, OFF);
    expect(out[14]).toEqual(red);
    expect(out[1]).toEqual(OFF);
  });
});

describe('cyan/purple columns preset on 0055', () => {
  const colors = columnsPalette(rk61);
  const row = (labels: string[]) => labels.map(l => code(colors[byLabel(l)])).join('');

  test('golden row patterns from factory geometry', () => {
    expect(row(['Esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'])).toBe(
      'CPCPCPCPCPCPCP'
    );
    expect(row(['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'])).toBe(
      'CPCPCPCPCPCPCC'
    );
    // Wide Caps Lock spans columns 0-1, so A starts on column 2.
    expect(row(['Caps Lock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'])).toBe(
      'CCPCPCPCPCPCP'
    );
  });

  test('each 1U key in a row differs from its immediate 1U neighbor', () => {
    const letters = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];
    const pattern = row(letters);
    for (let i = 1; i < pattern.length; i++) expect(pattern[i]).not.toBe(pattern[i - 1]);
  });

  test('keys stacked in the same physical column share a color', () => {
    const cols = geometricColumns(rk61);
    expect(cols.get(byLabel('2'))).toBe(cols.get(byLabel('W')));
    expect(colors[byLabel('2')]).toEqual(colors[byLabel('W')]);
  });

  test('every physical key is colored cyan or purple', () => {
    expect(Object.keys(colors)).toHaveLength(61);
    for (const k of rk61.keys) expect(code(colors[k.bIndex])).not.toBe('?');
  });
});

describe('sparse, nonsequential and missing-key layouts', () => {
  // Array order deliberately differs from both bIndex and x order.
  const sparse = {
    keys: [
      key(40, 0x44, 96), // D
      key(3, 0x41, 0), // A
      key(77, 0x51, 144), // Q
      key(12, 0x53, 48), // S
    ],
  };

  test('missing WASD keys leave remaining keys colored without guessing slots', () => {
    const out = wasdPalette(sparse); // no W
    expect(out).toEqual({ 3: BLUE, 12: BLUE, 40: BLUE, 77: WHITE });
  });

  test('columns follow x geometry, not array or bIndex order', () => {
    expect(columnsPalette(sparse)).toEqual({ 3: CYAN, 12: PURPLE, 40: CYAN, 77: PURPLE });
  });

  test('empty layout yields an empty map', () => {
    expect(columnsPalette({ keys: [] })).toEqual({});
    expect(wasdPalette({ keys: [] })).toEqual({});
  });
});

describe('fill and clear', () => {
  const layout = { keys: [key(5, 0x41, 0), key(9, 0x53, 48), key(30, 0x44, 96)] };
  const red = { r: 255, g: 0, b: 0 };

  test('fill selection keeps other keys and drops non-physical slots', () => {
    const current = { 5: WHITE, 9: WHITE, 99: WHITE };
    const out = fillKeys(layout, red, current, [9, 123]);
    expect(out).toEqual({ 5: WHITE, 9: red, 30: OFF });
  });

  test('fill without selection colors every physical key', () => {
    expect(fillKeys(layout, red)).toEqual({ 5: red, 9: red, 30: red });
  });

  test('clear sets selected keys to explicit off', () => {
    expect(clearKeys(layout, { 5: red, 9: red, 30: red }, [5])).toEqual({ 5: OFF, 9: red, 30: red });
    expect(clearKeys(layout, { 5: red })).toEqual({ 5: OFF, 9: OFF, 30: OFF });
  });

  test('inputs are not mutated and outputs do not alias inputs', () => {
    const current = { 5: { ...WHITE } };
    const out = fillKeys(layout, red, current, [9]);
    expect(current).toEqual({ 5: WHITE });
    out[5].r = 1;
    expect(current[5].r).toBe(255);
  });

  test('rejects non-integer or out-of-range channels', () => {
    for (const bad of [{ r: 256, g: 0, b: 0 }, { r: -1, g: 0, b: 0 }, { r: 1.5, g: 0, b: 0 }, { r: NaN, g: 0, b: 0 }]) {
      expect(() => fillKeys(layout, bad)).toThrow(RangeError);
    }
    expect(() => fillKeys(layout, red, { 5: { r: 300, g: 0, b: 0 } }, [9])).toThrow(RangeError);
    expect(() => columnsPalette(layout, { r: 0, g: 0, b: 999 })).toThrow(RangeError);
  });
});
