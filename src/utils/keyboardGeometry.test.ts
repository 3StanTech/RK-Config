/**
 * Golden layouts from real RK KB.ini files: the normalised board must keep every key,
 * never overlap two keys, sit on a quarter-unit grid and match the physical layout.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeKBIni } from './keyboardImages';
import { parseKeySection, parseUnRectKey } from './kbIniParser';
import { boxesOverlap, layoutKeys, shortLegend, type BoardLayout } from './keyboardGeometry';
import type { Key } from '../types/keyboard';

function load(pid: string): { keys: Key[]; layout: BoardLayout } {
  const text = decodeKBIni(readFileSync(join(process.cwd(), 'public', 'rk', 'Dev', pid, 'KB.ini')));
  const keys = parseKeySection(text);
  return { keys, layout: layoutKeys(keys, parseUnRectKey(text)) };
}

const box = (m: ReturnType<typeof load>, label: string) => {
  const key = m.keys.find(k => k.keyInfo.label === label);
  if (!key) throw new Error(`no ${label}`);
  return m.layout.keys[key.bIndex];
};

// 01C5, 01D9, 01FA and 0229 are ISO boards whose Enter once overlapped its neighbours
describe.each(['0055', '00EC', '0056', '0059', '01C5', '01D9', '01FA', '0229'])('%s layout', pid => {
  const m = load(pid);
  // Zero-size rects (knobs, media keys) have no place on the board
  const drawable = m.keys.filter(k => k.rect[2] > k.rect[0] && k.rect[3] > k.rect[1]);
  const boxes = drawable.map(k => m.layout.keys[k.bIndex]);

  test('every drawable key has a box', () => {
    expect(boxes.every(Boolean)).toBe(true);
  });

  test('no two keys overlap', () => {
    const pairs: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxesOverlap(boxes[i], boxes[j])) pairs.push(`${drawable[i].keyInfo.label}/${drawable[j].keyInfo.label}`);
      }
    }
    expect(pairs).toEqual([]);
  });

  test('boxes sit on the quarter-unit grid', () => {
    const off = boxes.flatMap(b => [b.x, b.y, b.w, b.h]).filter(v => (v * 4) % 1 !== 0);
    expect(off).toEqual([]);
  });

  test('legends are short', () => {
    const long = m.keys.map(k => shortLegend(k.keyInfo.label)).filter(l => l.length > 5);
    expect(long).toEqual([]);
  });
});

test('0055 (RK61) is a 15u by 5u 60% board', () => {
  const m = load('0055');
  expect([m.keys.length, m.layout.width, m.layout.height, m.layout.repairs]).toEqual([61, 15, 5, 0]);
  expect(box(m, 'Backspace')).toEqual({ x: 13, y: 0, w: 2, h: 1 });
  expect(box(m, 'Left Shift').w).toBe(2.25);
  expect(box(m, 'Right Shift')).toEqual({ x: 12.25, y: 3, w: 2.75, h: 1 });
  expect(box(m, 'Space')).toEqual({ x: 3.75, y: 4, w: 6.25, h: 1 });
  expect(m.layout.isoMatched).toBeNull();
});

test('00EC draws the ISO Enter from its UnRectKey outline', () => {
  const m = load('00EC');
  const enter = box(m, 'Enter');
  expect(m.layout.isoMatched).toBe(true);
  expect([enter.x, enter.y, enter.w, enter.h]).toEqual([13.5, 1, 1.5, 2]);
  expect(enter.shape?.length).toBeGreaterThanOrEqual(6);
  expect(m.layout.width).toBe(15);
  // The ISO key left of Enter sits in the notch under Enter's upper part
  const iso = m.keys.filter(k => k.keyInfo.label === '\\ |').map(k => m.layout.keys[k.bIndex]);
  expect(iso.some(b => b.y === 2 && b.x + b.w === 13.75)).toBe(true);
});

test('0056 numpad and arrows line up in columns', () => {
  const m = load('0056');
  expect([m.keys.length, m.layout.width, m.layout.height]).toEqual([100, 19, 6]);
  expect(box(m, 'Num 7').x).toBe(box(m, 'Num 1').x);
  expect(box(m, 'Up').x).toBe(box(m, 'Down').x);
  expect(box(m, 'Num +')).toEqual({ x: 18, y: 2, w: 1, h: 2 });
  expect(box(m, 'Num Enter')).toEqual({ x: 18, y: 4, w: 1, h: 2 });
});

test('0059 is a 16u 75% board with the arrow cluster under Page Down', () => {
  const m = load('0059');
  expect([m.keys.length, m.layout.width, m.layout.height]).toEqual([84, 16, 6]);
  expect(box(m, 'Page Down').x).toBe(box(m, 'Right').x);
  expect(box(m, 'Up').x).toBe(box(m, 'Down').x);
});

test('commented-out UnRectKey template lines are ignored', () => {
  expect(parseUnRectKey(';UnRectKey = 81,379,104, 379,127, 444,130')).toBeNull();
  expect(parseUnRectKey('UnRectKey=81,1,2,3,4')).toEqual([81, 1, 2, 3, 4]);
});
