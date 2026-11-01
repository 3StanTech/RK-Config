import type { KeyboardConfig } from '../types/keyboard';
import { ProtocolTranslator, type TransferArea, type TransferRecord } from './ProtocolTranslator';
import { OperationQueue } from './OperationQueue';
import type { StandardLightingSettings, PerKeyColors } from './LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import { loadFullProfile, saveProfile } from '../utils/profileStorage';
import {
  DeviceDisconnectedError,
  assertLightingSupported,
  validateColorUpdate,
  validateLightingRequest,
  validateLightingSettings,
  validateMappings,
  type ApplyResult,
  type KeyboardDevice,
  type WriteState,
} from './KeyboardDevice';

/**
 * Real Royal Kludge keyboard backed by the WebHID API.
 *
 * Holds the last applied state. Every hardware write runs on one OperationQueue;
 * applied state is published and saved only after all reports of an area resolve.
 */
export class HIDKeyboardDevice implements KeyboardDevice {
  readonly id: string;
  readonly hidDevice: HIDDevice;
  readonly config: KeyboardConfig;

  connected: boolean = true;
  mappings: Map<number, FirmwareCode> = new Map();

  // Lighting state
  lightingSettings: StandardLightingSettings | null = null;
  perKeyColors: PerKeyColors = {};

  // Loading states
  isMappingLoading: boolean = false;

  notify?: () => void;
  onDisconnect?: () => void;

  private translator: ProtocolTranslator;
  private queue = new OperationQueue();
  private applying = false;
  private uncertainAreas = new Set<TransferArea>();
  private navigatorDisconnectHandler?: (event: HIDConnectionEvent) => void;
  private deviceDisconnectHandler?: () => void;

  constructor(hidDevice: HIDDevice, config: KeyboardConfig) {
    this.hidDevice = hidDevice;
    this.config = config;
    // Include serial number if available for device-specific profiles
    const serial = hidDevice.serialNumber ? `-${hidDevice.serialNumber}` : '';
    this.id = `${hidDevice.vendorId}-${hidDevice.productId}-${hidDevice.productName}${serial}`;
    this.translator = new ProtocolTranslator(hidDevice, config);

    // Load saved applied state, filtered to this keyboard's keys and modes
    const profile = loadFullProfile(this.id, config);
    if (profile.mappings) {
      this.mappings = profile.mappings;
    }
    if (profile.perKeyColors) {
      this.perKeyColors = profile.perKeyColors;
    }

    // Initialize lighting - use saved settings or defaults
    if (config.lightEnabled && config.lightingModes.length > 0) {
      if (profile.lightingSettings) {
        this.lightingSettings = profile.lightingSettings;
      } else {
        const firstMode = config.lightingModes[0];
        this.lightingSettings = {
          modeIndex: firstMode.index,
          speed: 3, // Normal
          brightness: 5, // Max
          color: { r: 255, g: 255, b: 255 }, // White
          randomColor: false,
          sleep: 2, // 10 min default
        };
      }
    }

    // Listen for disconnect event on navigator.hid (global disconnect events)
    this.navigatorDisconnectHandler = (event: HIDConnectionEvent) => {
      if (event.device === hidDevice) {
        console.log('HID disconnect event fired for', hidDevice.productName);
        this.handleDisconnect();
      }
    };
    if (navigator.hid) {
      navigator.hid.addEventListener('disconnect', this.navigatorDisconnectHandler);
    }

    // Also listen on the device itself (belt and suspenders)
    this.deviceDisconnectHandler = () => {
      console.log('HID device disconnect event fired for', hidDevice.productName);
      this.handleDisconnect();
    };
    hidDevice.addEventListener('disconnect', this.deviceDisconnectHandler);
  }

  get writeState(): WriteState {
    if (this.applying) return 'applying';
    return this.uncertainAreas.size > 0 ? 'uncertain' : 'idle';
  }

  private handleDisconnect() {
    if (!this.connected) return; // Already handled

    console.log('Handling disconnect for device:', this.hidDevice.productName);
    this.connected = false;

    // Clean up event listeners
    this.cleanup();

    this.onDisconnect?.();
    this.notify?.();
  }

  /**
   * Clean up event listeners and resources
   * Should be called when device is disconnected or removed
   */
  cleanup(): void {
    if (this.navigatorDisconnectHandler && navigator.hid) {
      navigator.hid.removeEventListener('disconnect', this.navigatorDisconnectHandler);
      this.navigatorDisconnectHandler = undefined;
    }

    if (this.deviceDisconnectHandler) {
      this.hidDevice.removeEventListener('disconnect', this.deviceDisconnectHandler);
      this.deviceDisconnectHandler = undefined;
    }
  }

  // ---------------------------------------------------------------------------
  // Batch apply
  // ---------------------------------------------------------------------------

  async applyMappings(mappings: Map<number, FirmwareCode>): Promise<ApplyResult> {
    this.assertConnected();
    const candidate = validateMappings(this.config, mappings);
    return this.queue.enqueue(() => this.commitMappings(candidate));
  }

  async applyLighting(settings: StandardLightingSettings, colors?: PerKeyColors): Promise<ApplyResult> {
    this.assertConnected();
    const { settings: s, colors: c } = validateLightingRequest(this.config, settings, colors);
    return this.queue.enqueue(() => this.commitLighting(s, c));
  }

  // ---------------------------------------------------------------------------
  // Single-change compatibility paths. Each computes its candidate from the
  // applied state at execution time (not call time) so queued calls compose.
  // ---------------------------------------------------------------------------

  async setMapping(keyIndex: number, fwCode: FirmwareCode): Promise<void> {
    this.assertConnected();
    validateMappings(this.config, new Map([[keyIndex, fwCode]]));
    await this.queue.enqueue(() => {
      const candidate = new Map(this.mappings);
      candidate.set(keyIndex, fwCode);
      return this.commitMappings(candidate);
    });
  }

  async clearMapping(keyIndex: number): Promise<void> {
    this.assertConnected();
    await this.queue.enqueue(async () => {
      if (!this.mappings.has(keyIndex)) return;
      const candidate = new Map(this.mappings);
      candidate.delete(keyIndex);
      await this.commitMappings(candidate);
    });
  }

  async clearAll(): Promise<void> {
    this.assertConnected();
    await this.queue.enqueue(() => this.commitMappings(new Map()));
  }

  getMapping(keyIndex: number): FirmwareCode | undefined {
    return this.mappings.get(keyIndex);
  }

  hasMapping(keyIndex: number): boolean {
    return this.mappings.has(keyIndex);
  }

  /** Legacy global-only path: exactly one global report, no color packets. */
  async setLighting(settings: StandardLightingSettings): Promise<void> {
    this.assertConnected();
    assertLightingSupported(this.config);
    const s = validateLightingSettings(this.config, settings);
    await this.queue.enqueue(() => this.commitLighting(s, undefined));
  }

  /** Legacy color-only path: the seven color reports, no mode change. */
  async setPerKeyColors(colors: PerKeyColors): Promise<void> {
    this.assertConnected();
    const c = validateColorUpdate(this.config, colors);
    await this.queue.enqueue(() => this.commitLighting(undefined, c));
  }

  async setKeyColor(bIndex: number, r: number, g: number, b: number): Promise<void> {
    this.assertConnected();
    validateColorUpdate(this.config, { [bIndex]: { r, g, b } });
    await this.queue.enqueue(() =>
      this.commitLighting(undefined, { ...this.perKeyColors, [bIndex]: { r, g, b } })
    );
  }

  async clearKeyColor(bIndex: number): Promise<void> {
    this.assertConnected();
    // Off is a valid color for any physical key; this checks support and membership.
    validateColorUpdate(this.config, { [bIndex]: { r: 0, g: 0, b: 0 } });
    await this.queue.enqueue(() => {
      const colors = { ...this.perKeyColors };
      delete colors[bIndex];
      return this.commitLighting(undefined, colors);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal commit helpers. These run inside a queued operation and never
  // enqueue, so they cannot deadlock or interleave with other writes.
  // ---------------------------------------------------------------------------

  private async commitMappings(candidate: Map<number, FirmwareCode>): Promise<ApplyResult> {
    await this.transmit('keymap', () => this.translator.sendProfile(candidate));
    this.mappings = candidate;
    const persisted = saveProfile(this.id, { mappings: candidate });
    this.notify?.();
    return { persisted };
  }

  private async commitLighting(
    settings: StandardLightingSettings | undefined,
    colors: PerKeyColors | undefined
  ): Promise<ApplyResult> {
    await this.transmit('lighting', () => this.translator.sendLighting(settings, colors));
    if (settings) this.lightingSettings = settings;
    if (colors) this.perKeyColors = colors;
    const persisted = saveProfile(this.id, { lightingSettings: settings, perKeyColors: colors });
    this.notify?.();
    return { persisted };
  }

  /**
   * Run one area's transfer. On success the area is no longer uncertain. On
   * failure the applied state is untouched; the area becomes uncertain if any
   * report was attempted. No retry, replay or rollback is performed.
   */
  private async transmit(area: TransferArea, send: () => Promise<void>): Promise<void> {
    if (!this.connected) {
      throw new DeviceDisconnectedError(this.config.name);
    }
    this.applying = true;
    this.isMappingLoading = area === 'keymap';
    this.translator.lastTransfer = null;
    this.notify?.();
    try {
      await send();
      this.uncertainAreas.delete(area);
    } catch (error) {
      // Re-read after the await; TS keeps the pre-await `null` narrowing.
      const transfer = this.translator.lastTransfer as TransferRecord | null;
      if (transfer && transfer.attempted > 0) {
        this.uncertainAreas.add(area);
      }
      this.applying = false;
      this.isMappingLoading = false;
      this.notify?.();
      throw error;
    }
    // Success: the caller publishes applied state and notifies once.
    this.applying = false;
    this.isMappingLoading = false;
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new DeviceDisconnectedError(this.config.name);
    }
  }
}
