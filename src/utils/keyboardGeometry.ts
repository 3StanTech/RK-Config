/**
 * Normalise RK's KB.ini key rectangles into a clean key grid.
 *
 * RK's rects trace key tops in each factory photo, so gaps and row spacing are uneven.
 * This turns them into key units (1u = one standard key) snapped to quarter units,
 * keeps every key, repairs overlaps inside a row and draws ISO Enter from UnRectKey.
 */

import type { Key } from '../types/keyboard';

/** One key's box in key units; `shape` is an outline (ISO Enter) relative to the box. */
export interface KeyBox {
  x: number;
  y: number;
  w: number;
  h: number;
  shape?: Array<[number, number]>;
}

/** Board drawn from KB.ini data. Plain object so it serialises from the build into props. */
export interface BoardLayout {
  /** Board size in key units. */
  width: number;
  height: number;
  /** Keyed by bIndex. */
  keys: Record<number, KeyBox>;
  /** Keys moved to stop an overlap inside a row. */
  repairs: number;
  /** ISO outline matched to an Enter key; null when the file has no usable outline. */
  isoMatched: boolean | null;
}

const snap = (v: number) => Math.round(v * 4) / 4;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Most common size (1 px buckets) among the smallest keys: the 1u size. */
function unitSize(sizes: number[]): number {
  const sorted = sizes.filter(s => s > 0).sort((a, b) => a - b);
  const small = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0] ?? 1;
  const counts = new Map<number, number>();
  for (const s of sorted) {
    if (s > small * 1.3) break;
    const r = Math.round(s);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  let best = small;
  let bestCount = 0;
  for (const [s, c] of counts) {
    if (c > bestCount) { best = s; bestCount = c; }
  }
  return best;
}

/** Outline points (image pixels) from UnRectKey numbers: an id, then x,y pairs. */
function outlinePoints(unRect: number[] | null | undefined): Array<[number, number]> | null {
  if (!unRect || unRect.length < 7) return null;
  const pts: Array<[number, number]> = [];
  for (let i = 1; i + 1 < unRect.length; i += 2) pts.push([unRect[i], unRect[i + 1]]);
  // Drop a closing point that repeats the first
  const [fx, fy] = pts[0];
  const [lx, ly] = pts[pts.length - 1];
  if (pts.length > 3 && fx === lx && fy === ly) pts.pop();
  return pts.length >= 3 ? pts : null;
}

export function layoutKeys(keys: Key[], unRect?: number[] | null): BoardLayout {
  const drawn = keys.filter(k => k.rect[2] > k.rect[0] && k.rect[3] > k.rect[1]);
  if (drawn.length === 0) return { width: 0, height: 0, keys: {}, repairs: 0, isoMatched: null };

  const u = unitSize(drawn.map(k => k.rect[2] - k.rect[0]));
  const uh = unitSize(drawn.map(k => k.rect[3] - k.rect[1]));
  const minLeft = Math.min(...drawn.map(k => k.rect[0]));

  // ISO Enter: the outline belongs to an Enter key whose rect overlaps its bounds
  const poly = outlinePoints(unRect);
  let iso: Key | null = null;
  let pb: [number, number, number, number] | null = null;
  if (poly) {
    pb = [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
    const [l, t, r, b] = pb;
    iso = drawn.find(k => /^Ent/i.test(k.keyInfo.label) && k.rect[0] < r && k.rect[2] > l && k.rect[1] < b && k.rect[3] > t) ?? null;
  }

  // Rows from vertical centres; tall keys (numpad + and Enter, ISO Enter) join later
  const isTall = (k: Key) => k === iso || k.rect[3] - k.rect[1] > uh * 1.5;
  const flat = drawn.filter(k => !isTall(k)).sort((a, b) => (a.rect[1] + a.rect[3]) - (b.rect[1] + b.rect[3]));
  const rows: Array<{ centre: number; keys: Key[] }> = [];
  for (const k of flat) {
    const c = (k.rect[1] + k.rect[3]) / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(c - row.centre) <= uh * 0.5) {
      row.keys.push(k);
      row.centre += (c - row.centre) / row.keys.length;
    } else {
      rows.push({ centre: c, keys: [k] });
    }
  }

  // Horizontal pitch: the spacing between neighbouring 1u keys in a row (rects are key tops,
  // so the gap between them is wide); g is the part of a pitch not covered by a key top
  const isUnit = (k: Key) => Math.abs(k.rect[2] - k.rect[0] - u) <= u * 0.15;
  const steps: number[] = [];
  for (const row of rows) {
    const sorted = [...row.keys].sort((a, b) => a.rect[0] - b.rect[0]);
    for (let i = 1; i < sorted.length; i++) {
      const step = sorted[i].rect[0] - sorted[i - 1].rect[0];
      if (isUnit(sorted[i]) && isUnit(sorted[i - 1]) && step > u && step < u * 2) steps.push(step);
    }
  }
  const p = median(steps) ?? u;
  const g = p - u;
  const rowSteps = rows.slice(1).map((r, i) => r.centre - rows[i].centre).filter(d => d > uh && d <= uh * 2);
  const pitchY = median(rowSteps) ?? p;
  const gy = Math.max(0, pitchY - uh);

  // Left edges stacked in a column (numpad, arrows) share one x, so photo drift doesn't stagger them
  const leftOf = (k: Key) => (k === iso && pb ? pb[0] : k.rect[0]);
  const lefts = drawn.map(leftOf).sort((a, b) => a - b);
  const column = new Map<number, number>();
  for (let i = 0; i < lefts.length;) {
    let j = i;
    while (j + 1 < lefts.length && lefts[j + 1] - lefts[i] <= p * 0.12) j++;
    const group = lefts.slice(i, j + 1);
    const mean = group.reduce((a, b) => a + b, 0) / group.length;
    for (const l of group) column.set(l, mean);
    i = j + 1;
  }
  const xOf = (k: Key) => snap(((column.get(leftOf(k)) ?? leftOf(k)) - minLeft) / p);

  const boxes: Record<number, KeyBox> = {};
  let repairs = 0;
  const rowY: number[] = [];
  rows.forEach((row, i) => {
    let y = snap((row.centre - rows[0].centre) / pitchY);
    if (i > 0 && y < rowY[i - 1] + 1) y = rowY[i - 1] + 1;
    rowY.push(y);
    // The first key is placed on the board; each next key follows the previous one by its own
    // rounded gap, so rounding never staggers a run of keys
    let end = -Infinity;
    let prevRight = 0;
    for (const k of [...row.keys].sort((a, b) => a.rect[0] - b.rect[0])) {
      const w = Math.max(0.5, snap((k.rect[2] - k.rect[0] + g) / p));
      let x = end === -Infinity ? xOf(k) : end + snap((k.rect[0] - prevRight - g) / p);
      if (x < end) { x = end; repairs++; }
      end = x + w;
      prevRight = k.rect[2];
      boxes[k.bIndex] = { x, y, w, h: 1 };
    }
  });

  // Tall keys take the y of the row their top edge sits in
  const rowIndexAt = (top: number) => {
    let best = 0;
    rows.forEach((r, i) => {
      if (Math.abs(r.centre - (top + uh / 2)) < Math.abs(rows[best].centre - (top + uh / 2))) best = i;
    });
    return best;
  };
  for (const k of drawn.filter(isTall)) {
    if (k === iso) continue;
    const [l, t, r, b] = k.rect;
    const box: KeyBox = {
      x: xOf(k),
      y: rowY[rowIndexAt(t)] ?? 0,
      w: Math.max(0.5, snap((r - l + g) / p)),
      h: Math.max(1, snap((b - t + gy) / pitchY)),
    };
    // A tall key never covers a row key it shares rows with: move it past that key
    for (const other of Object.values(boxes)) {
      if (other.x <= box.x && boxesOverlap(box, other)) {
        box.x = other.x + other.w;
        repairs++;
      }
    }
    boxes[k.bIndex] = box;
  }

  // ISO Enter spans its top row and the row below. It is placed from its neighbours, not from
  // its outline's pixels: it ends where the key above it ends (Backspace), starts where its
  // top-row neighbour ends, and its notch starts where its bottom-row neighbour ends.
  if (iso && poly && pb) {
    const [pl, pt, pr, pbottom] = pb;
    const top = rowIndexAt(pt);
    const bottom = Math.min(top + 1, rows.length - 1);
    const endOf = (row: number, edge: number) => {
      const near = (rows[row]?.keys ?? [])
        .filter(o => o.rect[2] <= edge + u * 0.3)
        .sort((a, b) => b.rect[2] - a.rect[2])[0];
      const box = near && boxes[near.bIndex];
      return box ? box.x + box.w : null;
    };
    const aboveEnd = (rows[top - 1]?.keys ?? [])
      .filter(o => Math.abs(o.rect[2] - pr) <= u * 0.5)
      .map(o => boxes[o.bIndex])
      .map(b => b.x + b.w)[0];
    const right = aboveEnd ?? snap((pr - minLeft + g) / p);
    const left = endOf(top, pl) ?? snap((pl - minLeft) / p);
    const lowerLeft = Math.min(...poly.filter(([, y]) => y === pbottom).map(([x]) => x));
    const notchAt = endOf(bottom, lowerLeft) ?? snap((lowerLeft - minLeft) / p);
    const w = right - left;
    const h = bottom > top ? rowY[bottom] + 1 - rowY[top] : 1;
    const notch = Math.min(Math.max(0, notchAt - left), w - 0.25);
    boxes[iso.bIndex] = {
      x: left,
      y: rowY[top],
      w,
      h,
      shape: [[0, 0], [w, 0], [w, h], [notch, h], [notch, 1], [0, 1]],
    };
  }

  const all = Object.values(boxes);
  return {
    width: Math.max(...all.map(b => b.x + b.w)),
    height: Math.max(...all.map(b => b.y + b.h)),
    keys: boxes,
    repairs,
    isoMatched: poly ? iso !== null : null,
  };
}

function inPolygon(x: number, y: number, pts: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether two key boxes overlap; a shaped key (ISO Enter) uses its outline. */
export function boxesOverlap(a: KeyBox, b: KeyBox): boolean {
  if (!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)) return false;
  const shaped = a.shape ? a : b.shape ? b : null;
  if (!shaped) return true;
  const other = shaped === a ? b : a;
  const e = 0.1;
  const probes: Array<[number, number]> = [
    [other.x + other.w / 2, other.y + other.h / 2],
    [other.x + e, other.y + e], [other.x + other.w - e, other.y + e],
    [other.x + e, other.y + other.h - e], [other.x + other.w - e, other.y + other.h - e],
  ];
  return probes.some(([x, y]) => inPolygon(x - shaped.x, y - shaped.y, shaped.shape!));
}

/** Keycap-style short forms for long key names; the accessible name keeps the full label. */
const SHORT: Record<string, string> = {
  'Caps Lock': 'Caps',
  'Backspace': 'Back',
  'Escape': 'Esc',
  'Page Up': 'PgUp',
  'Page Down': 'PgDn',
  'Print Screen': 'PrtSc',
  'Scroll Lock': 'ScrLk',
  'Insert': 'Ins',
  'Delete': 'Del',
  'Num Lock': 'Num',
  'App': 'Menu',
  'Space': '',
  'Up': '↑',
  'Down': '↓',
  'Left': '←',
  'Right': '→',
  'Up Arrow': '↑',
  'Down Arrow': '↓',
  'Left Arrow': '←',
  'Right Arrow': '→',
  'Num Enter': 'Enter',
  'Calculator': 'Calc',
  'Volume Up': 'Vol+',
  'Volume Down': 'Vol−',
  'Previous Track': 'Prev',
  'Next Track': 'Next',
  'Play/Pause': 'Play',
  'Select All (Ctrl+A)': 'All',
  'Space (Right)': '',
  'Sleep?': 'Sleep',
  'Unknown': '',
};

export function shortLegend(label: string): string {
  if (label in SHORT) return SHORT[label];
  // Unnamed keys (VK fallback) get a blank cap; "Copy (Ctrl+C)" → "Copy"; "Num 7" → "7"
  if (/^VK 0x/.test(label)) return '';
  const action = /^(\w+) \(Ctrl\+\w\)$/.exec(label);
  if (action) return action[1];
  if (/^Num \S$/.test(label)) return label.slice(4);
  const side = label.replace(/^(Left|Right) (?=\S)/, '');
  if (side !== label) return side in SHORT ? SHORT[side] : side;
  return label;
}
