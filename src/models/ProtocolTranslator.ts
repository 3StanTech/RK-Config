import type { KeyboardConfig } from '../types/keyboard';
import { BufferCodec } from './BufferCodec';
import { LightingCodec, type StandardLightingSettings, type PerKeyColors } from './LightingCodec';
import type { FirmwareCode } from '../types/keycode';

export type TransferArea = 'keymap' | 'lighting';

/**
 * Report-count record of the most recent transfer. Holds counts and packet
 * positions only, never report contents.
 */
export interface TransferRecord {
  area: TransferArea;
  /** Reports the transfer intended to send. */
  planned: number;
  /** Reports handed to sendFeatureReport (including one that then failed). */
  attempted: number;
  /** Reports whose sendFeatureReport resolved. */
  sent: number;
  ok: boolean;
}

function isDevelopment(): boolean {
  return import.meta.env?.DEV === true;
}

/**
 * Translates profile mappings to HID buffers and sends to keyboard
 */
export class ProtocolTranslator {
  private device: HIDDevice;
  private config: KeyboardConfig;

  /** Most recent transfer, used to tell "nothing sent" from "partially sent". */
  lastTransfer: TransferRecord | null = null;

  constructor(device: HIDDevice, config: KeyboardConfig) {
    this.device = device;
    this.config = config;
  }

  /**
   * Send profile mappings to keyboard hardware
   * Encodes mappings into 9 HID buffers and sends sequentially via feature reports
   * @param mappings - Map of key index to RK firmware code
   */
  async sendProfile(mappings: Map<number, FirmwareCode>): Promise<void> {
    const buffers = BufferCodec.encode(mappings, this.config);
    await this.sendReports('keymap', buffers);
  }

  /**
   * Send standard lighting mode settings to keyboard
   * Encodes settings into 1 HID buffer and sends via feature report
   */
  async sendStandardLighting(settings: StandardLightingSettings): Promise<void> {
    await this.sendReports('lighting', [LightingCodec.encodeStandardLighting(settings)]);
  }

  /**
   * Send custom per-key RGB colors to keyboard
   * Encodes colors into 7 HID buffers and sends sequentially via feature reports
   */
  async sendCustomRGB(colors: PerKeyColors): Promise<void> {
    await this.sendReports('lighting', LightingCodec.encodeCustomRGB(colors));
  }

  /**
   * Send one lighting transaction: the global report (if settings are given)
   * followed by the seven per-key color reports (if colors are given), as one
   * ordered sequence with no other writes interleaved.
   */
  async sendLighting(settings?: StandardLightingSettings, colors?: PerKeyColors): Promise<void> {
    const buffers: Uint8Array[] = [];
    if (settings) buffers.push(LightingCodec.encodeStandardLighting(settings));
    if (colors) buffers.push(...LightingCodec.encodeCustomRGB(colors));
    await this.sendReports('lighting', buffers);
  }

  /**
   * Send already-encoded buffers in order. The report ID (0x0a) is buffer[0];
   * sendFeatureReport receives the remaining 64 bytes.
   */
  private async sendReports(area: TransferArea, buffers: Uint8Array[]): Promise<void> {
    const record: TransferRecord = { area, planned: buffers.length, attempted: 0, sent: 0, ok: false };
    this.lastTransfer = record;
    try {
      for (const buffer of buffers) {
        record.attempted++;
        await this.device.sendFeatureReport(buffer[0], buffer.slice(1));
        record.sent++;
      }
      record.ok = true;
    } finally {
      if (isDevelopment()) {
        // Serialized so the inspector shows the values, not "Object".
        // Counts, area and 1-based packet indexes only; never report contents.
        console.debug('[rk-transfer]', JSON.stringify({ ...record, packets: buffers.map(b => b[2]) }));
      }
    }
  }
}
