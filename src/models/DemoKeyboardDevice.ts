import type { KeyboardConfig } from '../types/keyboard';
import type { StandardLightingSettings, PerKeyColors } from './LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import { OperationQueue } from './OperationQueue';
import {
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
 * Demo keyboard device that simulates all operations without hardware.
 * Used for demo mode to let users explore the UI without a physical keyboard.
 * It applies the same validation and queue ordering as the real device but never
 * touches hardware or browser storage, so every ApplyResult has `persisted: false`.
 */
export class DemoKeyboardDevice implements KeyboardDevice {
  readonly id: string;
  readonly hidDevice: HIDDevice; // Mock HIDDevice
  readonly config: KeyboardConfig;
  readonly isDemo: boolean = true;

  connected: boolean = true;
  mappings: Map<number, FirmwareCode> = new Map();

  // Lighting state
  lightingSettings: StandardLightingSettings | null = null;
  perKeyColors: PerKeyColors = {};

  // Loading states
  isMappingLoading: boolean = false;

  notify?: () => void;
  onDisconnect?: () => void;

  private queue = new OperationQueue();
  private applying = false;

  constructor(config: KeyboardConfig) {
    this.config = config;

    // Create a mock HIDDevice object
    this.hidDevice = this.createMockHIDDevice(config);

    // Generate demo device ID
    const pid = parseInt(config.pid, 16);
    this.id = `demo-${0x258a}-${pid}-${config.name}`;

    // Initialize lighting with defaults (no persistence in demo mode)
    if (config.lightEnabled && config.lightingModes.length > 0) {
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

  get writeState(): WriteState {
    return this.applying ? 'applying' : 'idle';
  }

  /**
   * Create a mock HIDDevice object for demo purposes
   */
  private createMockHIDDevice(config: KeyboardConfig): HIDDevice {
    const pid = parseInt(config.pid, 16);

    // Create a mock object that satisfies the HIDDevice interface
    const mock = {
      vendorId: 0x258a, // Royal Kludge vendor ID
      productId: pid,
      productName: config.name,
      serialNumber: 'DEMO-MODE',
      opened: true,
      collections: [
        {
          usagePage: 0x0001,
          usage: 0x0080,
          type: 0,
          children: [],
        }
      ],
      // Mock methods
      open: async () => {},
      close: async () => {},
      forget: async () => {},
      sendReport: async () => {},
      sendFeatureReport: async () => {},
      receiveFeatureReport: async () => new DataView(new ArrayBuffer(0)),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      oninputreport: null,
    } as unknown as HIDDevice;

    return mock;
  }

  /**
   * No-op cleanup for demo device
   */
  cleanup(): void {
    // Demo device has no real event listeners to clean up
  }

  async applyMappings(mappings: Map<number, FirmwareCode>): Promise<ApplyResult> {
    const candidate = validateMappings(this.config, mappings);
    return this.queue.enqueue(() => this.commitMappings(candidate, 150));
  }

  async applyLighting(settings: StandardLightingSettings, colors?: PerKeyColors): Promise<ApplyResult> {
    const { settings: s, colors: c } = validateLightingRequest(this.config, settings, colors);
    return this.queue.enqueue(() => this.commitLighting(s, c));
  }

  async setMapping(keyIndex: number, fwCode: FirmwareCode): Promise<void> {
    validateMappings(this.config, new Map([[keyIndex, fwCode]]));
    await this.queue.enqueue(() => {
      const candidate = new Map(this.mappings);
      candidate.set(keyIndex, fwCode);
      return this.commitMappings(candidate, 100);
    });
  }

  async clearMapping(keyIndex: number): Promise<void> {
    await this.queue.enqueue(async () => {
      if (!this.mappings.has(keyIndex)) return;
      const candidate = new Map(this.mappings);
      candidate.delete(keyIndex);
      await this.commitMappings(candidate, 100);
    });
  }

  async clearAll(): Promise<void> {
    await this.queue.enqueue(() => this.commitMappings(new Map(), 150));
  }

  getMapping(keyIndex: number): FirmwareCode | undefined {
    return this.mappings.get(keyIndex);
  }

  hasMapping(keyIndex: number): boolean {
    return this.mappings.has(keyIndex);
  }

  async setLighting(settings: StandardLightingSettings): Promise<void> {
    assertLightingSupported(this.config);
    const s = validateLightingSettings(this.config, settings);
    await this.queue.enqueue(() => this.commitLighting(s, undefined));
  }

  async setPerKeyColors(colors: PerKeyColors): Promise<void> {
    const c = validateColorUpdate(this.config, colors);
    await this.queue.enqueue(() => this.commitLighting(undefined, c));
  }

  async setKeyColor(bIndex: number, r: number, g: number, b: number): Promise<void> {
    validateColorUpdate(this.config, { [bIndex]: { r, g, b } });
    await this.queue.enqueue(() =>
      this.commitLighting(undefined, { ...this.perKeyColors, [bIndex]: { r, g, b } })
    );
  }

  async clearKeyColor(bIndex: number): Promise<void> {
    // Off is a valid color for any physical key; this checks support and membership.
    validateColorUpdate(this.config, { [bIndex]: { r: 0, g: 0, b: 0 } });
    await this.queue.enqueue(() => {
      const colors = { ...this.perKeyColors };
      delete colors[bIndex];
      return this.commitLighting(undefined, colors);
    });
  }

  private async commitMappings(candidate: Map<number, FirmwareCode>, delayMs: number): Promise<ApplyResult> {
    this.applying = true;
    this.isMappingLoading = true;
    this.notify?.();
    await this.simulateDelay(delayMs);
    this.mappings = candidate;
    this.applying = false;
    this.isMappingLoading = false;
    this.notify?.();
    return { persisted: false };
  }

  private async commitLighting(
    settings: StandardLightingSettings | undefined,
    colors: PerKeyColors | undefined
  ): Promise<ApplyResult> {
    this.applying = true;
    this.notify?.();
    await this.simulateDelay(colors ? 100 : 80);
    if (settings) this.lightingSettings = settings;
    if (colors) this.perKeyColors = colors;
    this.applying = false;
    this.notify?.();
    return { persisted: false };
  }

  /**
   * Helper to simulate async delay for realistic feel
   */
  private async simulateDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
