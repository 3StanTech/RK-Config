/**
 * Pure modifier-chord rules for RK classic firmware codes.
 *
 * A chord is up to eight modifier bits plus an optional regular USB HID base key:
 *   code = (modifierMask << 16) | (hidUsage << 8)
 * Left Ctrl/Shift/Alt/GUI are bits 0x01/0x02/0x04/0x08; right are 0x10/0x20/0x40/0x80,
 * matching the existing single-modifier codes in KEY_MAP.
 *
 * Codes outside this shape (Fn 0xb000, media/consumer 0x01xxxxxx, unverified captures)
 * are never decoded as chords and are never produced by encodeChord; callers keep them
 * as-is. Platform only changes labels (Command = GUI, Option = Alt); bits never change.
 */
import { KEY_MAP, type FirmwareCode } from '../types/keycode';

export type ModifierId =
  | 'leftCtrl' | 'leftShift' | 'leftAlt' | 'leftGui'
  | 'rightCtrl' | 'rightShift' | 'rightAlt' | 'rightGui';

export type LabelPlatform = 'mac' | 'windows';

type ModifierKind = 'ctrl' | 'shift' | 'alt' | 'gui';

export interface ModifierInfo {
  id: ModifierId;
  bit: number;
  side: 'left' | 'right';
  kind: ModifierKind;
}

/** Display order: kind (Ctrl, Shift, Alt, GUI), left before right. */
export const MODIFIERS: readonly ModifierInfo[] = [
  { id: 'leftCtrl', bit: 0x01, side: 'left', kind: 'ctrl' },
  { id: 'rightCtrl', bit: 0x10, side: 'right', kind: 'ctrl' },
  { id: 'leftShift', bit: 0x02, side: 'left', kind: 'shift' },
  { id: 'rightShift', bit: 0x20, side: 'right', kind: 'shift' },
  { id: 'leftAlt', bit: 0x04, side: 'left', kind: 'alt' },
  { id: 'rightAlt', bit: 0x40, side: 'right', kind: 'alt' },
  { id: 'leftGui', bit: 0x08, side: 'left', kind: 'gui' },
  { id: 'rightGui', bit: 0x80, side: 'right', kind: 'gui' },
];

export const MAX_MODIFIER_MASK = 0xff;

const KIND_LABELS: Record<LabelPlatform, Record<ModifierKind, string>> = {
  windows: { ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', gui: 'Win' },
  mac: { ctrl: 'Control', shift: 'Shift', alt: 'Option', gui: 'Command' },
};

export interface KeyChord {
  /** Modifier bit mask, integer 0..0xff. */
  modifiers: number;
  /** Regular USB HID usage of the base key, or null for a modifier-only chord. */
  base: number | null;
}

export interface BaseKey {
  hid: number;
  label: string;
}

const MIN_BASE_HID = 0x04;
const MAX_BASE_HID = 0x65;
/** KEY_MAP entries from unverified captures that must not become composable bases. */
const EXCLUDED_VKS = new Set([0xd8]);
const LABEL_OVERRIDES: Record<number, string> = { 0x64: 'ISO \\ |' };

function buildBaseKeys(): Map<number, string> {
  const bases = new Map<number, string>();
  for (const info of Object.values(KEY_MAP)) {
    if (EXCLUDED_VKS.has(info.vk) || info.category === 'Media') continue;
    const fw = info.fw;
    if ((fw & 0xff) !== 0 || fw > 0xffff) continue;
    const hid = fw >>> 8;
    if (hid < MIN_BASE_HID || hid > MAX_BASE_HID || bases.has(hid)) continue;
    bases.set(hid, LABEL_OVERRIDES[hid] ?? info.label);
  }
  return bases;
}

const BASE_KEYS = buildBaseKeys();

/** Supported regular base keys, ordered by HID usage. */
export function getSupportedBaseKeys(): BaseKey[] {
  return [...BASE_KEYS.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hid, label]) => ({ hid, label }));
}

export function isSupportedBase(hid: number): boolean {
  return Number.isInteger(hid) && BASE_KEYS.has(hid);
}

export function isValidModifierMask(mask: number): boolean {
  return Number.isInteger(mask) && mask >= 0 && mask <= MAX_MODIFIER_MASK;
}

export function modifierMaskFromIds(ids: Iterable<ModifierId>): number {
  let mask = 0;
  for (const id of ids) {
    const info = MODIFIERS.find((m) => m.id === id);
    if (!info) throw new RangeError(`Unknown modifier: ${String(id)}`);
    mask |= info.bit;
  }
  return mask;
}

export function modifierIdsFromMask(mask: number): ModifierId[] {
  if (!isValidModifierMask(mask)) throw new RangeError(`Invalid modifier mask: ${mask}`);
  return MODIFIERS.filter((m) => (mask & m.bit) !== 0).map((m) => m.id);
}

/** Validation error text for a chord, or null when it can be encoded. */
export function chordError(chord: KeyChord): string | null {
  if (!isValidModifierMask(chord.modifiers)) return 'Modifier mask must be an integer 0..0xff';
  if (chord.base !== null && !isSupportedBase(chord.base)) return 'Unsupported base key';
  if (chord.base === null && chord.modifiers === 0) return 'Choose a modifier or a base key';
  return null;
}

/** Encode a chord to an unsigned firmware code. Throws RangeError for unsupported input. */
export function encodeChord(chord: KeyChord): FirmwareCode {
  const error = chordError(chord);
  if (error) throw new RangeError(error);
  return ((chord.modifiers << 16) | ((chord.base ?? 0) << 8)) >>> 0;
}

/**
 * Decode a firmware code into a chord. Returns null for any code that is not a
 * supported modifier/base chord (Fn, media, other special values, invalid integers);
 * such codes must be preserved unchanged.
 */
export function decodeChord(code: FirmwareCode): KeyChord | null {
  if (!Number.isInteger(code) || code <= 0 || code > 0xffffff) return null;
  if ((code & 0xff) !== 0) return null;
  const modifiers = (code >>> 16) & 0xff;
  const hid = (code >>> 8) & 0xff;
  if (hid === 0) return modifiers === 0 ? null : { modifiers, base: null };
  if (!BASE_KEYS.has(hid)) return null;
  return { modifiers, base: hid };
}

export function isChordCode(code: FirmwareCode): boolean {
  return decodeChord(code) !== null;
}

export function modifierLabel(id: ModifierId, platform: LabelPlatform): string {
  const info = MODIFIERS.find((m) => m.id === id);
  if (!info) throw new RangeError(`Unknown modifier: ${String(id)}`);
  return `${info.side === 'left' ? 'Left' : 'Right'} ${KIND_LABELS[platform][info.kind]}`;
}

/** Human label such as "Left Ctrl + Right Shift + A". */
export function chordLabel(chord: KeyChord, platform: LabelPlatform): string {
  const error = chordError(chord);
  if (error) throw new RangeError(error);
  const parts = modifierIdsFromMask(chord.modifiers).map((id) => modifierLabel(id, platform));
  if (chord.base !== null) parts.push(BASE_KEYS.get(chord.base) as string);
  return parts.join(' + ');
}

/**
 * Label any firmware code: chords via chordLabel, other known codes via KEY_MAP,
 * otherwise an uppercase hex fallback.
 */
export function firmwareCodeLabel(code: FirmwareCode, platform: LabelPlatform): string {
  const chord = decodeChord(code);
  if (chord) return chordLabel(chord, platform);
  const known = Object.values(KEY_MAP).find((info) => info.fw === code);
  if (known) return known.label;
  if (!Number.isInteger(code) || code < 0 || code > 0xffffffff) return `Invalid code ${String(code)}`;
  return `0x${code.toString(16).toUpperCase()}`;
}
