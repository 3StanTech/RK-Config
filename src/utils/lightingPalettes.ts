/**
 * Static per-key palette transforms.
 *
 * Every function is pure and returns a complete PerKeyColors map covering
 * exactly the physical keys in `config.keys`, addressed by each key's bIndex
 * (its slot in the RGB buffer). Array position is never used as an identity,
 * so sparse and nonsequential bIndex layouts are preserved. These are app
 * presets for a static custom-mode map, not firmware animations.
 */

import type { KeyboardConfig, Key } from '../types/keyboard';
import type { PerKeyColors } from '../models/LightingCodec';

export type RgbColor = PerKeyColors[number];

export const OFF: RgbColor = { r: 0, g: 0, b: 0 };
export const WHITE: RgbColor = { r: 255, g: 255, b: 255 };
export const BLUE: RgbColor = { r: 0, g: 0, b: 255 };
export const CYAN: RgbColor = { r: 0, g: 255, b: 255 };
export const PURPLE: RgbColor = { r: 128, g: 0, b: 255 };

/** Windows VK codes for W, A, S, D (the KB.ini source identity of each key). */
const WASD_VK = new Set([0x57, 0x41, 0x53, 0x44]);

type PaletteKeys = Pick<KeyboardConfig, 'keys'>;

function isChannel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

/** Throws RangeError unless every channel is an integer in 0..255. Returns a copy. */
export function assertColor(color: RgbColor): RgbColor {
  if (!color || !isChannel(color.r) || !isChannel(color.g) || !isChannel(color.b)) {
    throw new RangeError(`Invalid RGB color: ${JSON.stringify(color)}`);
  }
  return { r: color.r, g: color.g, b: color.b };
}

/** Builds a complete map: each physical key gets colorFor(key). */
function mapKeys(config: PaletteKeys, colorFor: (key: Key) => RgbColor): PerKeyColors {
  const out: PerKeyColors = {};
  for (const key of config.keys) out[key.bIndex] = { ...colorFor(key) };
  return out;
}

/**
 * Sets the selected keys (or all keys when `selection` is omitted) to `color`.
 * Other physical keys keep their color from `current`, or OFF when absent.
 * Selection entries and `current` entries that are not physical keys are dropped.
 */
export function fillKeys(
  config: PaletteKeys,
  color: RgbColor,
  current: PerKeyColors = {},
  selection?: Iterable<number>
): PerKeyColors {
  const fill = assertColor(color);
  const selected = selection ? new Set(selection) : null;
  return mapKeys(config, key => {
    if (!selected || selected.has(key.bIndex)) return fill;
    const existing = current[key.bIndex];
    return existing ? assertColor(existing) : OFF;
  });
}

/** Turns the selected keys (or all keys) off, keeping other keys' colors. */
export function clearKeys(
  config: PaletteKeys,
  current: PerKeyColors = {},
  selection?: Iterable<number>
): PerKeyColors {
  return fillKeys(config, OFF, current, selection);
}

/** WASD keys in `accent`, every other physical key in `base`. Missing WASD keys are simply absent. */
export function wasdPalette(
  config: PaletteKeys,
  accent: RgbColor = BLUE,
  base: RgbColor = WHITE
): PerKeyColors {
  const a = assertColor(accent);
  const b = assertColor(base);
  return mapKeys(config, key => (WASD_VK.has(key.keyInfo.vk) ? a : b));
}

function centerX(key: Key): number {
  return (key.rect[0] + key.rect[2]) / 2;
}

function overlapsVertically(a: Key, b: Key): boolean {
  return a.rect[1] < b.rect[3] && b.rect[1] < a.rect[3];
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * The layout's 1U horizontal pitch, measured from geometry: for each key, the
 * distance to the nearest key center to its right that shares vertical space;
 * the pitch is the mean of those gaps within 10% of their median. The mean
 * avoids the integer-pixel bias of a bare median, which otherwise drifts one
 * column across a 14-key row. Falls back to the median key width when no key
 * has a neighbor.
 */
export function horizontalPitch(keys: readonly Key[]): number {
  const gaps: number[] = [];
  for (const key of keys) {
    let nearest = Infinity;
    for (const other of keys) {
      if (other === key || !overlapsVertically(key, other)) continue;
      const gap = centerX(other) - centerX(key);
      if (gap > 0 && gap < nearest) nearest = gap;
    }
    if (nearest !== Infinity) gaps.push(nearest);
  }
  if (gaps.length > 0) {
    const mid = median(gaps);
    const near = gaps.filter(g => Math.abs(g - mid) <= mid * 0.1);
    return near.reduce((sum, g) => sum + g, 0) / near.length;
  }
  const widths = keys.map(k => k.rect[2] - k.rect[0]).filter(w => w > 0);
  return widths.length > 0 ? median(widths) : 1;
}

/**
 * Geometric column of each key: floor((centerX - leftmost edge) / pitch).
 * Derived from factory rectangles, so staggered rows fall into the column
 * their center physically occupies.
 */
export function geometricColumns(config: PaletteKeys): Map<number, number> {
  const columns = new Map<number, number>();
  if (config.keys.length === 0) return columns;
  const pitch = horizontalPitch(config.keys);
  const left = Math.min(...config.keys.map(k => k.rect[0]));
  for (const key of config.keys) {
    columns.set(key.bIndex, Math.floor((centerX(key) - left) / pitch));
  }
  return columns;
}

/** Alternating geometric columns: even columns `even`, odd columns `odd`. */
export function columnsPalette(
  config: PaletteKeys,
  even: RgbColor = CYAN,
  odd: RgbColor = PURPLE
): PerKeyColors {
  const e = assertColor(even);
  const o = assertColor(odd);
  const columns = geometricColumns(config);
  return mapKeys(config, key => (columns.get(key.bIndex)! % 2 === 0 ? e : o));
}

export const PALETTE_PRESETS = [
  { id: 'wasd', name: 'WASD blue, rest white', build: (config: PaletteKeys) => wasdPalette(config) },
  { id: 'columns', name: 'Cyan and purple columns', build: (config: PaletteKeys) => columnsPalette(config) },
] as const;

export type PalettePresetId = typeof PALETTE_PRESETS[number]['id'];

/** Display labels for the lighting sliders, indexed by setting value - 1. */
export const SPEED_LABELS = ['Very Slow', 'Slow', 'Normal', 'Fast', 'Very Fast'];
export const SLEEP_LABELS = ['5 min', '10 min', '20 min', '30 min', 'Off'];

/** One-click colours offered for global lighting and per-key painting. */
export const QUICK_COLORS: ReadonlyArray<{ name: string } & RgbColor> = [
  { name: 'White', r: 255, g: 255, b: 255 },
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 165, b: 0 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
];

/** `#RRGGBB`, upper case. */
export function toHex(c: RgbColor): string {
  return `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Parses a 6-digit hex colour (with or without `#`); null when invalid. */
export function fromHex(value: string): RgbColor | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
