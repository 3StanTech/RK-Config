import type { KeyboardConfig } from '../types/keyboard';
import { HIDKeyboardDevice } from './HIDKeyboardDevice';
import { parseKBIni } from '../utils/kbIniParser';
import { WebHIDNotAvailableError, UnsupportedKeyboardError, UserCancelledError, DeviceOpenError } from '../errors/KludgeKnightErrors';
import {
  checkClassicReportShape,
  classifyDevice,
  classicRequestFilters,
  formatPid,
  hasClassicConfigInterface,
  summarizeDescriptor,
  type ClassicCapabilities,
  type IncompatibleReason,
} from '../constants/deviceCapabilities';

/**
 * Thrown before open() or construction when a device is not a compatible
 * classic RK writer. Subclasses UnsupportedKeyboardError so existing handling applies.
 */
export class IncompatibleDeviceError extends UnsupportedKeyboardError {
  readonly reason: IncompatibleReason;
  readonly detail: string;
  readonly guidance: string;
  constructor(pid: string, reason: IncompatibleReason, detail: string, guidance: string) {
    super(pid);
    this.name = 'IncompatibleDeviceError';
    this.message = `${guidance} (${detail})`;
    this.reason = reason;
    this.detail = detail;
    this.guidance = guidance;
  }
}

/**
 * Singleton manager for HID device lifecycle
 */
export class HIDDeviceManager {
  private static instance: HIDDeviceManager;
  private devices: Map<string, HIDKeyboardDevice> = new Map();
  private configs: Map<string, KeyboardConfig> = new Map();
  private capabilities: Map<string, ClassicCapabilities> = new Map();
  private opening: Map<string, Promise<HIDKeyboardDevice | null>> = new Map(); // Track devices currently being opened
  private ledManifest: string | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Set the LED manifest (called from DeviceProvider)
   */
  setLedManifest(manifest: string) {
    this.ledManifest = manifest;
  }

  /**
   * Get the LED manifest
   */
  getLedManifest(): string | null {
    return this.ledManifest;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): HIDDeviceManager {
    if (!HIDDeviceManager.instance) {
      HIDDeviceManager.instance = new HIDDeviceManager();
    }
    return HIDDeviceManager.instance;
  }

  /**
   * Get config for a PID, loading it on-demand if needed
   */
  private async getConfig(pid: string): Promise<KeyboardConfig | null> {
    // Check cache first
    if (this.configs.has(pid)) {
      return this.configs.get(pid)!;
    }

    // Load on-demand
    try {
      const config = await parseKBIni(pid, this.ledManifest);
      if (config) {
        this.configs.set(pid, config);
      }
      return config;
    } catch (error) {
      console.error(`Failed to load config for PID ${pid}:`, error);
      return null;
    }
  }

  /**
   * Request device from user (shows browser picker)
   * Opens device and creates HIDKeyboardDevice instance
   */
  async requestDevice(): Promise<HIDKeyboardDevice | null> {
    if (!navigator.hid) {
      throw new WebHIDNotAvailableError();
    }

    try {
      // RK vendor ID with the default configuration interface (0001:0080), plus
      // interfaces explicitly observed for specific PIDs (see CLASSIC_VARIANT_METADATA).
      const devices = await navigator.hid.requestDevice({ filters: classicRequestFilters() });

      if (devices.length === 0) {
        throw new UserCancelledError();
      }

      // The picker can return several interfaces; prefer the one with the classic report shape.
      const hidDevice = devices.find(d => checkClassicReportShape(d).ok) ?? devices[0];
      return await this.openDevice(hidDevice);
    } catch (error) {
      // User cancelled the picker (browser throws DOMException)
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new UserCancelledError();
      }
      console.error('Failed to request device:', error);
      throw error;
    }
  }

  /**
   * Scan for previously authorized devices
   * Useful for reconnecting on page reload
   */
  async scanAuthorizedDevices(): Promise<HIDKeyboardDevice[]> {
    if (!navigator.hid) {
      throw new WebHIDNotAvailableError();
    }

    try {
      const hidDevices = await navigator.hid.getDevices();
      console.log(`Found ${hidDevices.length} authorized HID devices`);
      const keyboards: HIDKeyboardDevice[] = [];

      for (const hidDevice of hidDevices) {
        if (import.meta.env.DEV) {
          console.debug('[rk-descriptor] scan', summarizeDescriptor(hidDevice));
        }
        // Only process RK keyboards exposing a configuration interface accepted for their PID
        if (hasClassicConfigInterface(hidDevice)) {
          try {
            console.log(`Attempting to open RK device: ${hidDevice.productName}`);
            const keyboard = await this.openDevice(hidDevice);
            if (keyboard) {
              console.log(`Successfully opened device: ${keyboard.config.name}`);
              keyboards.push(keyboard);
            }
          } catch (error) {
            // Log but continue with other devices
            console.warn(`Failed to open device ${hidDevice.productName}:`, error);
          }
        }
      }

      console.log(`Successfully connected to ${keyboards.length} RK keyboards`);
      return keyboards;
    } catch (error) {
      console.error('Failed to scan authorized devices:', error);
      return [];
    }
  }

  /**
   * Open a HID device and create HIDKeyboardDevice instance
   */
  private async openDevice(hidDevice: HIDDevice): Promise<HIDKeyboardDevice | null> {
    // Generate device ID early
    const serial = hidDevice.serialNumber ? `-${hidDevice.serialNumber}` : '';
    const deviceId = `${hidDevice.vendorId}-${hidDevice.productId}-${hidDevice.productName}${serial}`;

    // Check if device is already in manager (prevents duplicate opens in React Strict Mode)
    if (this.devices.has(deviceId)) {
      console.log(`Device already in manager: ${hidDevice.productName}`);
      return this.devices.get(deviceId)!;
    }

    // Check if device is currently being opened - await the existing promise
    if (this.opening.has(deviceId)) {
      console.log(`Device is already being opened, awaiting existing promise...`);
      return await this.opening.get(deviceId)!;
    }

    // Create the opening promise
    const openingPromise = this.performOpen(hidDevice);
    this.opening.set(deviceId, openingPromise);

    try {
      const device = await openingPromise;
      return device;
    } finally {
      // Always clean up the opening promise when done (success or failure)
      this.opening.delete(deviceId);
    }
  }

  /**
   * Internal method to perform the actual device opening
   */
  private async performOpen(hidDevice: HIDDevice): Promise<HIDKeyboardDevice | null> {
    try {
      // Load config for this device on-demand
      const pid = formatPid(hidDevice.productId);

      if (import.meta.env.DEV) {
        console.debug('[rk-descriptor] open', summarizeDescriptor(hidDevice));
      }
      // Reject incompatible report shapes before fetching config, opening, or constructing a writer.
      const loaded = checkClassicReportShape(hidDevice).ok ? await this.getConfig(pid) : null;
      const classification = classifyDevice(hidDevice, loaded);
      if (!classification.supported) {
        console.warn(`Incompatible device PID ${pid}: ${classification.reason} (${classification.detail})`);
        throw new IncompatibleDeviceError(pid, classification.reason, classification.detail, classification.guidance);
      }
      // A supported classification guarantees a loaded config for this PID.
      const config = loaded!;

      // Debug: Log HID collections to understand device structure
      console.log('HID Device collections:', hidDevice.collections);
      console.log('Product name:', hidDevice.productName);

      // Open device if not already open
      if (!hidDevice.opened) {
        console.log(`Opening device (currently closed): ${hidDevice.productName}`);
        try {
          await hidDevice.open();
        } catch (openError) {
          if (openError instanceof DOMException && openError.name === 'InvalidStateError') {
            // Device is already open, safe to proceed
            console.log(`Device already open: ${hidDevice.productName}`);
          } else {
            console.error(`device.open() failed for ${hidDevice.productName}:`, openError);
            throw new DeviceOpenError(pid);
          }
        }
        console.log(`Device opened successfully: ${hidDevice.productName}`);
      } else {
        console.log(`Device already open: ${hidDevice.productName}`);
      }

      // Create HIDKeyboardDevice instance
      const device = new HIDKeyboardDevice(hidDevice, config);
      this.devices.set(device.id, device);
      this.capabilities.set(device.id, classification.capabilities);

      return device;
    } catch (error) {
      console.error('Failed to open device:', error);
      throw error;
    }
  }

  /**
   * Get device by ID
   */
  getDevice(id: string): HIDKeyboardDevice | undefined {
    return this.devices.get(id);
  }

  /**
   * Classic capabilities established when the device was opened
   */
  getCapabilities(id: string): ClassicCapabilities | undefined {
    return this.capabilities.get(id);
  }

  /**
   * Get all connected devices
   */
  getAllDevices(): HIDKeyboardDevice[] {
    return Array.from(this.devices.values());
  }

  /**
   * Remove device from manager (e.g., on disconnect)
   * Ensures proper cleanup of event listeners
   */
  removeDevice(id: string): void {
    const device = this.devices.get(id);
    if (device) {
      // Clean up event listeners before removing
      device.cleanup();
      this.devices.delete(id);
      this.capabilities.delete(id);
    }
  }
}
