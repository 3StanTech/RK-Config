import type { KeyboardConfig } from '../types/keyboard';
import type { StandardLightingSettings, PerKeyColors } from './LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import { LightingNotSupportedError, RGBNotSupportedError } from '../errors/KludgeKnightErrors';
import { deriveCapabilities, type ClassicCapabilities } from '../constants/deviceCapabilities';

/**
 * Outcome of a successful hardware apply.
 * `persisted` is false when every report was sent but the browser could not
 * save the applied state (e.g. storage quota). A failed transfer rejects instead.
 */
export interface ApplyResult {
  persisted: boolean;
}

/**
 * - `idle`: no write in progress and no transfer is known to have failed part-way.
 * - `applying`: a queued apply is transmitting.
 * - `uncertain`: a transfer failed after at least one report was attempted, so the
 *   keyboard may hold a mix of old and new configuration. Cleared for an area by
 *   the next successful apply of that area. There is no readback or rollback.
 */
export type WriteState = 'idle' | 'applying' | 'uncertain';

/** Thrown before transmission when an apply request fails validation. */
export class InvalidApplyRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidApplyRequestError';
  }
}

/** Thrown before transmission when the device is no longer connected. */
export class DeviceDisconnectedError extends Error {
  constructor(deviceName: string) {
    super(`Keyboard ${deviceName} is disconnected`);
    this.name = 'DeviceDisconnectedError';
  }
}

/**
 * Shared shape for real and demo keyboard devices.
 * Both HIDKeyboardDevice and DemoKeyboardDevice implement this so that
 * consumers can hold a single type and stay in lockstep on the public API.
 *
 * `mappings`, `lightingSettings` and `perKeyColors` hold the last applied state;
 * drafts belong to the UI and are never stored here.
 */
export interface KeyboardDevice {
  readonly id: string;
  readonly hidDevice: HIDDevice;
  readonly config: KeyboardConfig;
  readonly isDemo?: boolean;

  connected: boolean;
  mappings: Map<number, FirmwareCode>;
  lightingSettings: StandardLightingSettings | null;
  perKeyColors: PerKeyColors;
  isMappingLoading: boolean;
  readonly writeState: WriteState;

  notify?: () => void;
  onDisconnect?: () => void;

  cleanup(): void;

  /**
   * Apply a complete keymap (bIndex → firmware code; absent keys use factory codes).
   * Sends exactly nine keymap reports in one queued operation.
   */
  applyMappings(mappings: Map<number, FirmwareCode>): Promise<ApplyResult>;
  /**
   * Apply lighting in one queued operation.
   * - Standard mode (no colors): exactly one global report.
   * - The variant's established custom mode: colors are required; the global
   *   report is followed by all seven color reports, with every physical key
   *   not listed sent as off.
   * Colors with a non-custom mode, or on a variant without established per-key
   * color support, are rejected before transmission.
   */
  applyLighting(settings: StandardLightingSettings, colors?: PerKeyColors): Promise<ApplyResult>;

  setMapping(keyIndex: number, fwCode: FirmwareCode): Promise<void>;
  clearMapping(keyIndex: number): Promise<void>;
  clearAll(): Promise<void>;
  getMapping(keyIndex: number): FirmwareCode | undefined;
  hasMapping(keyIndex: number): boolean;

  setLighting(settings: StandardLightingSettings): Promise<void>;
  setPerKeyColors(colors: PerKeyColors): Promise<void>;
  setKeyColor(bIndex: number, r: number, g: number, b: number): Promise<void>;
  clearKeyColor(bIndex: number): Promise<void>;
}

const MAX_FIRMWARE_CODE = 0xffffffff;

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function isColorChannel(value: unknown): value is number {
  return isIntInRange(value, 0, 255);
}

/**
 * Snapshot and validate a keymap request against the connected configuration.
 * Returns a fresh Map so later caller mutations cannot affect a queued apply.
 */
export function validateMappings(
  config: KeyboardConfig,
  mappings: Map<number, FirmwareCode>
): Map<number, FirmwareCode> {
  if (!(mappings instanceof Map)) {
    throw new InvalidApplyRequestError('Mappings must be a Map');
  }
  const validIndexes = new Set(config.keys.map(k => k.bIndex));
  const snapshot = new Map<number, FirmwareCode>();
  for (const [bIndex, fwCode] of mappings) {
    if (!validIndexes.has(bIndex)) {
      throw new InvalidApplyRequestError(`Key index ${bIndex} is not in ${config.name}`);
    }
    if (!isIntInRange(fwCode, 0, MAX_FIRMWARE_CODE)) {
      throw new InvalidApplyRequestError(`Firmware code for key ${bIndex} is out of range`);
    }
    snapshot.set(bIndex, fwCode);
  }
  return snapshot;
}

/** Snapshot and validate global lighting settings against the configuration. */
export function validateLightingSettings(
  config: KeyboardConfig,
  settings: StandardLightingSettings
): StandardLightingSettings {
  if (!settings || typeof settings !== 'object') {
    throw new InvalidApplyRequestError('Lighting settings are required');
  }
  if (!config.lightingModes.some(m => m.index === settings.modeIndex)) {
    throw new InvalidApplyRequestError(`Lighting mode ${settings.modeIndex} is not in ${config.name}`);
  }
  if (!isIntInRange(settings.speed, 1, 5)) {
    throw new InvalidApplyRequestError('Lighting speed must be an integer 1-5');
  }
  if (!isIntInRange(settings.brightness, 0, 5)) {
    throw new InvalidApplyRequestError('Lighting brightness must be an integer 0-5');
  }
  if (!isIntInRange(settings.sleep, 1, 5)) {
    throw new InvalidApplyRequestError('Lighting sleep must be an integer 1-5');
  }
  if (typeof settings.randomColor !== 'boolean') {
    throw new InvalidApplyRequestError('Lighting randomColor must be a boolean');
  }
  const c = settings.color;
  if (!c || !isColorChannel(c.r) || !isColorChannel(c.g) || !isColorChannel(c.b)) {
    throw new InvalidApplyRequestError('Lighting color channels must be integers 0-255');
  }
  return {
    modeIndex: settings.modeIndex,
    speed: settings.speed,
    brightness: settings.brightness,
    color: { r: c.r, g: c.g, b: c.b },
    randomColor: settings.randomColor,
    sleep: settings.sleep,
  };
}

/** Snapshot and validate per-key colors against the configuration's keys. */
export function validatePerKeyColors(config: KeyboardConfig, colors: PerKeyColors): PerKeyColors {
  if (!colors || typeof colors !== 'object') {
    throw new InvalidApplyRequestError('Per-key colors must be an object');
  }
  const validIndexes = new Set(config.keys.map(k => k.bIndex));
  const snapshot: PerKeyColors = {};
  for (const [key, color] of Object.entries(colors)) {
    const bIndex = Number(key);
    if (!Number.isInteger(bIndex) || !validIndexes.has(bIndex)) {
      throw new InvalidApplyRequestError(`Key index ${key} is not in ${config.name}`);
    }
    if (!color || !isColorChannel(color.r) || !isColorChannel(color.g) || !isColorChannel(color.b)) {
      throw new InvalidApplyRequestError(`Color for key ${key} must use integer channels 0-255`);
    }
    snapshot[bIndex] = { r: color.r, g: color.g, b: color.b };
  }
  return snapshot;
}

export function assertLightingSupported(config: KeyboardConfig): void {
  if (!config.lightEnabled) {
    throw new LightingNotSupportedError(config.name);
  }
}

/** Per-key colors are allowed only on variants with an established custom mode. */
function assertPerKeyColorSupported(config: KeyboardConfig): ClassicCapabilities {
  assertLightingSupported(config);
  const capabilities = deriveCapabilities(config);
  if (!capabilities.perKeyColor || capabilities.customLightingMode === null) {
    throw new RGBNotSupportedError(config.name);
  }
  return capabilities;
}

/** Every physical key gets an explicit color; keys not listed are off. */
function normalizeCustomColors(config: KeyboardConfig, colors: PerKeyColors): PerKeyColors {
  const full: PerKeyColors = {};
  for (const key of config.keys) {
    full[key.bIndex] = colors[key.bIndex] ?? { r: 0, g: 0, b: 0 };
  }
  return full;
}

/**
 * Validate a batch lighting request (`applyLighting`) before transmission.
 * Colors are accepted only with the variant's established custom mode and are
 * returned as a complete per-key map; that custom mode in turn requires colors.
 */
export function validateLightingRequest(
  config: KeyboardConfig,
  settings: StandardLightingSettings,
  colors?: PerKeyColors
): { settings: StandardLightingSettings; colors?: PerKeyColors } {
  assertLightingSupported(config);
  const validSettings = validateLightingSettings(config, settings);
  const customMode = deriveCapabilities(config).customLightingMode;

  if (colors === undefined) {
    if (customMode !== null && validSettings.modeIndex === customMode) {
      throw new InvalidApplyRequestError(`Custom mode ${customMode} requires an explicit per-key color map`);
    }
    return { settings: validSettings };
  }

  const established = assertPerKeyColorSupported(config).customLightingMode;
  if (validSettings.modeIndex !== established) {
    throw new InvalidApplyRequestError(`Per-key colors require custom mode ${established}`);
  }
  return {
    settings: validSettings,
    colors: normalizeCustomColors(config, validatePerKeyColors(config, colors)),
  };
}

/**
 * Validate a color-only update from the single-change compatibility paths.
 * These send the seven color reports without a mode change, so no mode is
 * guessed; unestablished variants are rejected.
 */
export function validateColorUpdate(config: KeyboardConfig, colors: PerKeyColors): PerKeyColors {
  assertPerKeyColorSupported(config);
  return validatePerKeyColors(config, colors);
}
