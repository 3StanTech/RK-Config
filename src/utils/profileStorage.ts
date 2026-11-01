import { z } from 'zod';
import type { FirmwareCode } from '../types/keycode';
import type { KeyboardConfig } from '../types/keyboard';
import type { StandardLightingSettings, PerKeyColors } from '../models/LightingCodec';

/**
 * Last-applied browser state per device, stored under `kludgeknight_profile_{deviceId}`.
 *
 * Formats read:
 * - legacy: bare array of [bIndex, firmwareCode]
 * - version 2 (or unversioned object): { mappings?, lightingSettings? }
 * - version 3: version 2 plus perKeyColors as [bIndex, r, g, b] tuples
 * Writes always produce version 3. Drafts are never stored here.
 */
const STORAGE_PREFIX = 'kludgeknight_profile_';
const CURRENT_VERSION = 3;

const Channel = z.number().int().min(0).max(255);

const MappingTupleSchema = z.tuple([
  z.number().int().min(0), // keyIndex (bIndex)
  z.number().int().min(0).max(0xffffffff), // FirmwareCode
]);

const LightingSettingsSchema = z.object({
  modeIndex: z.number().int().min(1),
  speed: z.number().int().min(1).max(5),
  brightness: z.number().int().min(0).max(5),
  randomColor: z.boolean(),
  sleep: z.number().int().min(1).max(5),
  color: z.object({ r: Channel, g: Channel, b: Channel }),
});

const ColorTupleSchema = z.tuple([z.number().int().min(0), Channel, Channel, Channel]);

const DeviceProfileSchema = z.object({
  mappings: z.array(MappingTupleSchema).optional(),
  lightingSettings: LightingSettingsSchema.optional(),
  perKeyColors: z.array(ColorTupleSchema).optional(),
  version: z.number().int().min(1).max(CURRENT_VERSION).optional(),
});

// Legacy format support - just an array of mappings
const LegacyProfileSchema = z.array(MappingTupleSchema);

export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

export interface StoredProfile {
  mappings: Map<number, FirmwareCode> | null;
  lightingSettings: StandardLightingSettings | null;
  perKeyColors: PerKeyColors | null;
}

/** Areas to replace; an omitted field keeps the currently saved value. */
export interface ProfileUpdate {
  mappings?: Map<number, FirmwareCode>;
  lightingSettings?: StandardLightingSettings;
  perKeyColors?: PerKeyColors;
}

const EMPTY: StoredProfile = { mappings: null, lightingSettings: null, perKeyColors: null };

function emptyProfile(): StoredProfile {
  return { ...EMPTY };
}

/**
 * Parse stored JSON without filtering. Returns null for missing, corrupt or
 * unsupported data.
 */
function readStored(deviceId: string): StoredProfile | null {
  const json = localStorage.getItem(STORAGE_PREFIX + deviceId);
  if (!json) return null;

  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    console.warn('Ignoring unreadable saved profile');
    return null;
  }

  if (Array.isArray(data)) {
    const legacy = LegacyProfileSchema.safeParse(data);
    if (!legacy.success) {
      console.warn('Invalid legacy profile format:', z.prettifyError(legacy.error));
      return null;
    }
    return { mappings: new Map(legacy.data), lightingSettings: null, perKeyColors: null };
  }

  const result = DeviceProfileSchema.safeParse(data);
  if (!result.success) {
    console.warn('Invalid profile format:', z.prettifyError(result.error));
    return null;
  }

  const { mappings, lightingSettings, perKeyColors } = result.data;
  let colors: PerKeyColors | null = null;
  if (perKeyColors) {
    colors = {};
    for (const [bIndex, r, g, b] of perKeyColors) colors[bIndex] = { r, g, b };
  }
  return {
    mappings: mappings ? new Map(mappings) : null,
    lightingSettings: lightingSettings ?? null,
    perKeyColors: colors,
  };
}

/** Drop entries that do not belong to the connected configuration. */
function filterForConfig(profile: StoredProfile, config: KeyboardConfig): StoredProfile {
  const validIndexes = new Set(config.keys.map(k => k.bIndex));

  let mappings: Map<number, FirmwareCode> | null = null;
  if (profile.mappings) {
    mappings = new Map([...profile.mappings].filter(([bIndex]) => validIndexes.has(bIndex)));
  }

  const lightingSettings =
    profile.lightingSettings &&
    config.lightEnabled &&
    config.lightingModes.some(m => m.index === profile.lightingSettings!.modeIndex)
      ? profile.lightingSettings
      : null;

  let perKeyColors: PerKeyColors | null = null;
  if (profile.perKeyColors && config.lightEnabled && config.rgb) {
    perKeyColors = {};
    for (const [key, color] of Object.entries(profile.perKeyColors)) {
      const bIndex = Number(key);
      if (validIndexes.has(bIndex)) perKeyColors[bIndex] = color;
    }
  }

  return { mappings, lightingSettings, perKeyColors };
}

/**
 * Save applied state for a device, replacing only the given areas and keeping
 * other saved areas. Corrupt or unsupported existing data is replaced.
 * @returns true when the write succeeded; false on any storage failure (e.g. quota).
 */
export function saveProfile(deviceId: string, update: ProfileUpdate): boolean {
  try {
    const existing = readStored(deviceId) ?? emptyProfile();
    const mappings = update.mappings ?? existing.mappings;
    const lightingSettings = update.lightingSettings ?? existing.lightingSettings;
    const perKeyColors = update.perKeyColors ?? existing.perKeyColors;

    const profile: DeviceProfile = { version: CURRENT_VERSION };
    if (mappings) profile.mappings = Array.from(mappings.entries());
    if (lightingSettings) profile.lightingSettings = lightingSettings;
    if (perKeyColors) {
      profile.perKeyColors = Object.entries(perKeyColors).map(
        ([bIndex, c]) => [Number(bIndex), c.r, c.g, c.b] as [number, number, number, number]
      );
    }

    localStorage.setItem(STORAGE_PREFIX + deviceId, JSON.stringify(profile));
    return true;
  } catch (error) {
    console.error('Failed to save profile to localStorage:', error);
    return false;
  }
}

/**
 * Load key mappings from localStorage for a device (backward compatible)
 */
export function loadProfile(deviceId: string, config?: KeyboardConfig): Map<number, FirmwareCode> | null {
  return loadFullProfile(deviceId, config).mappings;
}

/**
 * Load the saved applied state. With a config, entries outside the connected
 * keyboard's keys/modes are dropped. Corrupt, unsupported or unreadable data
 * yields empty values; loading never writes to storage.
 */
export function loadFullProfile(deviceId: string, config?: KeyboardConfig): StoredProfile {
  try {
    const stored = readStored(deviceId);
    if (!stored) return emptyProfile();
    return config ? filterForConfig(stored, config) : stored;
  } catch (error) {
    console.error('Failed to load profile from localStorage:', error);
    return emptyProfile();
  }
}

/**
 * Clear saved profile for a device
 */
export function clearProfile(deviceId: string): void {
  try {
    localStorage.removeItem(STORAGE_PREFIX + deviceId);
  } catch (error) {
    console.error('Failed to clear profile from localStorage:', error);
  }
}
