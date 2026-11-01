import { useCallback, useRef, useState } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import { DeviceDisconnectedError, InvalidApplyRequestError } from '../models/KeyboardDevice';
import type { PerKeyColors, StandardLightingSettings } from '../models/LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import { deriveCapabilities } from '../constants/deviceCapabilities';
import { OFF, WHITE } from '../utils/lightingPalettes';
import { useToast } from './useToast';

export type DraftArea = 'keymap' | 'lighting';

type Rgb = PerKeyColors[number];

interface DraftState {
  /** The device object this draft belongs to. A new connection gets a new draft. */
  device: KeyboardDevice;
  mappings: Map<number, FirmwareCode>;
  lighting: StandardLightingSettings | null;
  /** Complete per-physical-key draft colors (empty when per-key color is unsupported). */
  colors: PerKeyColors;
  /**
   * Starting color for keys when no per-key map is saved in this browser: the
   * global color shown when the draft was created. An app starting value, not readback.
   */
  colorFallback: Rgb;
  errors: Record<DraftArea, string | null>;
  /** The last successful apply of this area could not be saved in the browser. */
  notSaved: Record<DraftArea, boolean>;
  /** This area was sent successfully at least once in this session (hardware still not read back). */
  sentThisSession: Record<DraftArea, boolean>;
  /**
   * A transfer of this area failed after reports were attempted, so the keyboard
   * may be partly updated. Independent of errors and draft count: Discard keeps it
   * so the area can be explicitly resent; only a successful apply of the same area clears it.
   */
  recovery: Record<DraftArea, boolean>;
}

function cloneSettings(s: StandardLightingSettings | null): StandardLightingSettings | null {
  return s ? { ...s, color: { ...s.color } } : null;
}

function sameColor(a: Rgb | undefined, b: Rgb | undefined): boolean {
  if (!a || !b) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/** Last applied colors as a complete map, or the starting fallback when nothing was saved. */
function baselineColors(device: KeyboardDevice, fallback: Rgb): PerKeyColors {
  if (!deriveCapabilities(device.config).perKeyColor) return {};
  const saved = device.perKeyColors;
  const hasSaved = Object.keys(saved).length > 0;
  const out: PerKeyColors = {};
  for (const key of device.config.keys) {
    const c = saved[key.bIndex] ?? (hasSaved ? OFF : fallback);
    out[key.bIndex] = { r: c.r, g: c.g, b: c.b };
  }
  return out;
}

function initDraft(device: KeyboardDevice): DraftState {
  const fallback = device.lightingSettings ? { ...device.lightingSettings.color } : { ...WHITE };
  return {
    device,
    mappings: new Map(device.mappings),
    lighting: cloneSettings(device.lightingSettings),
    colors: baselineColors(device, fallback),
    colorFallback: fallback,
    errors: { keymap: null, lighting: null },
    notSaved: { keymap: false, lighting: false },
    sentThisSession: { keymap: false, lighting: false },
    recovery: { keymap: false, lighting: false },
  };
}

function countMappingDiffs(draft: Map<number, FirmwareCode>, applied: Map<number, FirmwareCode>): number {
  const keys = new Set([...draft.keys(), ...applied.keys()]);
  let n = 0;
  for (const k of keys) if (draft.get(k) !== applied.get(k)) n++;
  return n;
}

function countSettingDiffs(draft: StandardLightingSettings | null, applied: StandardLightingSettings | null): number {
  if (!draft || !applied) return 0;
  let n = 0;
  if (draft.modeIndex !== applied.modeIndex) n++;
  if (draft.speed !== applied.speed) n++;
  if (draft.brightness !== applied.brightness) n++;
  if (!sameColor(draft.color, applied.color)) n++;
  if (draft.randomColor !== applied.randomColor) n++;
  if (draft.sleep !== applied.sleep) n++;
  return n;
}

function countColorDiffs(draft: PerKeyColors, applied: PerKeyColors): number {
  let n = 0;
  for (const key of Object.keys(draft)) {
    const b = Number(key);
    if (!sameColor(draft[b], applied[b])) n++;
  }
  return n;
}

function describeFailure(device: KeyboardDevice, area: DraftArea, error: unknown): string {
  const what = area === 'keymap' ? 'keymap' : 'lighting';
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (error instanceof DeviceDisconnectedError) {
    return `Nothing was sent: the keyboard is disconnected. Your draft is kept. (${detail})`;
  }
  if (error instanceof InvalidApplyRequestError) {
    return `Nothing was sent: this ${what} request was rejected before transfer. Your draft is kept. (${detail})`;
  }
  if (device.writeState === 'uncertain') {
    return `The ${what} transfer stopped part-way. The keyboard may be partly updated; it can't be rolled back or read. Your draft is unchanged and the browser record still shows the last successful Apply. Reconnect if needed and Retry Apply to send everything again. (${detail})`;
  }
  return `The ${what} transfer failed before any report was sent. Your draft is kept. (${detail})`;
}

/**
 * One draft owner for both editor panes of the selected device.
 *
 * Drafts are cloned from the device's last applied state and never mutate it.
 * Nothing here sends configuration except the explicit apply functions, which
 * each send one area. Applying one area leaves the other area's draft intact.
 * Switching to another device object (including a reconnect) discards the
 * draft without sending it.
 */
export function useDeviceDraft(device: KeyboardDevice) {
  const toast = useToast();
  const [state, setState] = useState<DraftState>(() => initDraft(device));
  const [applying, setApplying] = useState<DraftArea | null>(null);
  const [savedVersion, setSavedVersion] = useState(0);
  const deviceRef = useRef(device);
  deviceRef.current = device;

  // Derived-state reset when the selected device object changes (no effect, no send).
  let draft = state;
  if (state.device !== device) {
    draft = initDraft(device);
    setState(draft);
    if (applying) setApplying(null);
  }

  const capabilities = deriveCapabilities(device.config);
  const customMode = capabilities.customLightingMode;
  const appliedColors = baselineColors(device, draft.colorFallback);

  const keymapPending = countMappingDiffs(draft.mappings, device.mappings);
  const settingsPending = countSettingDiffs(draft.lighting, device.lightingSettings);
  const colorsPending = capabilities.perKeyColor ? countColorDiffs(draft.colors, appliedColors) : 0;
  /** Per-key colors are sent only together with the established custom mode. */
  const colorsSendable = customMode !== null && draft.lighting?.modeIndex === customMode;

  const update = useCallback((fn: (s: DraftState) => DraftState) => {
    setState(s => (s.device === deviceRef.current ? fn(s) : s));
  }, []);

  const stageMapping = useCallback((bIndex: number, code: FirmwareCode | undefined) => {
    update(s => {
      const mappings = new Map(s.mappings);
      const factory = s.device.config.keys.find(k => k.bIndex === bIndex)?.keyInfo.fw;
      if (code === undefined || code === factory) mappings.delete(bIndex);
      else mappings.set(bIndex, code);
      return { ...s, mappings };
    });
  }, [update]);

  const stageResetAllMappings = useCallback(() => {
    update(s => ({ ...s, mappings: new Map() }));
  }, [update]);

  const stageLighting = useCallback((settings: StandardLightingSettings) => {
    update(s => ({ ...s, lighting: cloneSettings(settings) }));
  }, [update]);

  const stageColors = useCallback((colors: PerKeyColors) => {
    update(s => {
      const next: PerKeyColors = {};
      for (const key of s.device.config.keys) {
        const c = colors[key.bIndex] ?? s.colors[key.bIndex] ?? OFF;
        next[key.bIndex] = { r: c.r, g: c.g, b: c.b };
      }
      return { ...s, colors: next };
    });
  }, [update]);

  // Restores this area's draft to the last applied baseline. Recovery is kept, so a
  // failed area can still be resent explicitly; the other area is untouched.
  const discard = useCallback((area: DraftArea) => {
    const d = deviceRef.current;
    const needsRecovery = state.device === d && state.recovery[area];
    update(s => area === 'keymap'
      ? { ...s, mappings: new Map(d.mappings), errors: { ...s.errors, keymap: null } }
      : {
          ...s,
          lighting: cloneSettings(d.lightingSettings),
          colors: baselineColors(d, s.colorFallback),
          errors: { ...s.errors, lighting: null },
        });
    const name = area === 'keymap' ? 'key' : 'lighting';
    toast.showInfo(needsRecovery
      ? `Discarded pending ${name} changes. Nothing was sent. The last ${name} transfer failed, so Retry Apply can still resend the last applied ${name} settings.`
      : `Discarded pending ${name} changes. Nothing was sent.`);
  }, [state, update, toast]);

  const apply = useCallback(async (area: DraftArea) => {
    const d = deviceRef.current;
    if (applying || state.device !== d) return;
    const snapshot = state;
    setApplying(area);
    update(s => ({ ...s, errors: { ...s.errors, [area]: null } }));
    try {
      let result;
      if (area === 'keymap') {
        result = await d.applyMappings(new Map(snapshot.mappings));
      } else {
        if (!snapshot.lighting) return;
        const custom = deriveCapabilities(d.config).customLightingMode;
        result = custom !== null && snapshot.lighting.modeIndex === custom
          ? await d.applyLighting(snapshot.lighting, snapshot.colors)
          : await d.applyLighting(snapshot.lighting);
      }
      if (deviceRef.current !== d) return;
      const label = area === 'keymap' ? 'Keymap' : 'Lighting';
      if (d.isDemo) {
        toast.showSuccess(`[DEMO] Simulated ${label.toLowerCase()} apply — nothing was written or saved.`);
      } else if (result.persisted) {
        toast.showSuccess(`${label} sent successfully and saved in this browser. The keyboard can't confirm it.`);
      } else {
        toast.showError(
          `${label} sent to the keyboard, but not saved in this browser. Storage is full or blocked, so it won't be restored next visit.`,
          15000
        );
      }
      update(s => ({
        ...s,
        notSaved: { ...s.notSaved, [area]: !d.isDemo && !result.persisted },
        sentThisSession: { ...s.sentThisSession, [area]: true },
        recovery: { ...s.recovery, [area]: false },
      }));
      setSavedVersion(v => v + 1);
    } catch (error) {
      console.error(`Apply ${area} failed:`, error);
      if (deviceRef.current !== d) return;
      const message = describeFailure(d, area, error);
      // Reports were attempted (not a pre-transfer rejection): the keyboard may be partly updated.
      const attempted =
        !(error instanceof DeviceDisconnectedError) &&
        !(error instanceof InvalidApplyRequestError) &&
        d.writeState === 'uncertain';
      update(s => ({
        ...s,
        errors: { ...s.errors, [area]: message },
        recovery: attempted ? { ...s.recovery, [area]: true } : s.recovery,
      }));
      toast.showError('Apply failed — see details in the pane. Your changes are still pending.');
    } finally {
      if (deviceRef.current === d) setApplying(null);
    }
  }, [applying, state, update, toast]);

  return {
    mappings: draft.mappings,
    lighting: draft.lighting,
    colors: draft.colors,
    appliedColors,
    capabilities,
    customMode,
    colorsSendable,
    keymapPending,
    settingsPending,
    colorsPending,
    lightingPending: settingsPending + colorsPending,
    errors: draft.errors,
    notSaved: draft.notSaved,
    sentThisSession: draft.sentThisSession,
    recovery: draft.recovery,
    applying,
    savedVersion,
    stageMapping,
    stageResetAllMappings,
    stageLighting,
    stageColors,
    discard,
    apply,
  };
}

export type DeviceDraft = ReturnType<typeof useDeviceDraft>;
