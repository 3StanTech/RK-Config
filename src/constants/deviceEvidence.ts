/**
 * Per-feature evidence for classic RK variants, kept separate from capability.
 *
 * - `source-derived`: inferred from shipped configuration files and protocol source only.
 * - `community-reported`: a third party reports it working; not reproduced here.
 * - `verified-fork`: physically observed working with this fork's build.
 *
 * Absence of a record means the feature rests only on the shipped configuration.
 * There is no blanket verification of the bundled model list. Add `verified-fork`
 * only for a feature that passed a physical run, with its date and observation.
 */

import type { DeviceFeature } from './deviceCapabilities';

export type EvidenceLevel = 'source-derived' | 'community-reported' | 'verified-fork';
export type Transport = 'usb' | 'bluetooth' | '2.4ghz';

export interface EvidenceRecord {
  /** Lowercase 4-digit PID (VID is always 0x258a). */
  pid: string;
  feature: DeviceFeature;
  level: EvidenceLevel;
  transport: Transport;
  /** ISO date (YYYY-MM-DD) the evidence was recorded. */
  recordedOn: string;
  /** Where the claim comes from: files, code, reports or physical runs. */
  sources: readonly string[];
  /** What was observed. Required for community-reported and verified-fork. */
  observation?: string;
}

const RK61_USB_DESCRIPTOR =
  'Read-only USB descriptor inspection 2026-10-31: 258A:0055, usage 0001:0080, feature report 0x0A, 65 bytes including ID (descriptor only, no write)';
const RK61_WEBHID_DESCRIPTOR =
  'Chrome WebHID descriptor observed 2026-11-01 (USB): no 0001:0080 collection exposed; consumer 000C:0001 input 0x02; vendor FF00:0001 feature 0x05 (5 bytes); vendor FF00:0001 feature 0x0A (64 bytes) (descriptor only, no write)';
const RK61_DESCRIPTOR = [RK61_USB_DESCRIPTOR, RK61_WEBHID_DESCRIPTOR];
const RK61_PHYSICAL_RUN =
  'Physical run 2026-11-01 to 2026-11-02: owner RK61 258A:0055 over USB in Chrome WebHID on macOS, changes applied through the app UI, key results read from browser keydown events, lighting results from owner observation';

export const EVIDENCE_RECORDS: readonly EvidenceRecord[] = [
  {
    pid: '0055',
    feature: 'keymap',
    level: 'verified-fork',
    transport: 'usb',
    recordedOn: '2026-11-02',
    sources: [
      'public/rk/Dev/0055/KB.ini [KEY] (LayoutKeyNum=61)',
      'BufferCodec nine-report keymap protocol (ported from Rangoli)',
      ...RK61_DESCRIPTOR,
      RK61_PHYSICAL_RUN,
    ],
    observation:
      'After one nine-report keymap Apply with CapsLock -> Escape and Menu -> Left Command+C: CapsLock produced Escape; ' +
      'Menu produced MetaLeft then KeyC with meta held; unchanged A still produced KeyA; Fn+1 produced F1 (followed by Digit1). ' +
      'All remaps behaved the same after a power cycle. Limitation: the full-map write does not preserve the native Mac mode; ' +
      'physical left Win/Alt send the Windows arrangement (MetaLeft/AltLeft) afterwards, and disconnecting, power cycling, ' +
      'writing the default map or Fn+S alone did not bring Mac mode back. Recovery that worked: hold Fn+Space 3-5 s until the backlight flashes (native ' +
      'reset, which also clears the remaps and lighting), then Fn+S; Mac positions, CapsLock and Menu were restored. Only these ' +
      'remaps, one modifier chord and Fn+1 were tested; other Fn functions, chords, models and transports are unverified.',
  },
  {
    pid: '0055',
    feature: 'globalLighting',
    level: 'verified-fork',
    transport: 'usb',
    recordedOn: '2026-11-02',
    sources: [
      'public/rk/Dev/0055/KB.ini [OPT] RGBKb=1, LedOpt1-21',
      'public/rk/Dev/en/led.xml tc_led_mode1-21 (mode 2 = Ripples Shining)',
      'LightingCodec global lighting report',
      ...RK61_DESCRIPTOR,
      RK61_PHYSICAL_RUN,
    ],
    observation:
      'A lighting-only Apply of mode 2 (Ripples Shining), speed 1, brightness 5, sleep 2, color #000CFF, random off restored the ' +
      "owner's original lighting after a native reset, confirmed by the owner. No keymap reports were sent, and left Alt/Win, " +
      'CapsLock and Menu kept their Mac-mode key events afterwards. Only this setting combination was confirmed physically.',
  },
  {
    pid: '0055',
    feature: 'perKeyColor',
    level: 'verified-fork',
    transport: 'usb',
    recordedOn: '2026-11-02',
    sources: [
      'public/rk/Dev/0055/KB.ini [OPT] RGBKb=1, LedOpt14',
      'public/rk/Dev/en/led.xml tc_led_mode14 = Customize (custom mode 14)',
      'LightingCodec.encodeCustomRGB seven color reports',
      ...RK61_DESCRIPTOR,
      RK61_PHYSICAL_RUN,
    ],
    observation:
      'Custom mode 14 with Q #FF0000, W #00FF00, E #0000FF and all other keys #FFFFFF lit exactly as set (GRB channel order ' +
      'confirmed). The WASD blue / rest white preset lit as set and still matched after a power cycle, with left Alt/Win and ' +
      'CapsLock keeping their Mac-mode key events.',
  },
];

/** Data-contract problems for one record; empty when valid. */
export function evidenceProblems(record: EvidenceRecord): string[] {
  const problems: string[] = [];
  if (!/^[0-9a-f]{4}$/.test(record.pid)) problems.push('pid must be 4 lowercase hex digits');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(record.recordedOn) ? new Date(`${record.recordedOn}T00:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== record.recordedOn) {
    problems.push('recordedOn must be a real YYYY-MM-DD date');
  }
  if (record.sources.length === 0 || record.sources.some(s => s.trim() === '')) {
    problems.push('at least one non-empty source is required');
  }
  if (record.level !== 'source-derived' && !record.observation?.trim()) {
    problems.push(`${record.level} evidence requires an observation`);
  }
  return problems;
}

/** The record for one feature on one transport, or null when only the shipped configuration backs it. */
export function getFeatureEvidence(
  pid: string,
  feature: DeviceFeature,
  transport: Transport = 'usb',
  records: readonly EvidenceRecord[] = EVIDENCE_RECORDS
): EvidenceRecord | null {
  const key = pid.toLowerCase();
  return records.find(r => r.pid === key && r.feature === feature && r.transport === transport) ?? null;
}

/** True only when a feature has a recorded physical pass with this fork on that transport. */
export function isVerifiedInFork(
  pid: string,
  feature: DeviceFeature,
  transport: Transport = 'usb',
  records: readonly EvidenceRecord[] = EVIDENCE_RECORDS
): boolean {
  return getFeatureEvidence(pid, feature, transport, records)?.level === 'verified-fork';
}
