/**
 * Classic RK protocol: report-shape checks and per-variant capability metadata.
 *
 * A device is writable with the classic driver only when its HID descriptor
 * exposes a configuration interface accepted for its exact PID (usage page
 * 0x0001 / usage 0x0080 by default, plus any interface explicitly observed for
 * that variant) with a feature report 0x0A carrying 64 payload bytes, AND a shipped configuration
 * exists for its exact VID/PID. Sharing a model name, or having RGB, is not
 * enough. Capability says what the driver can address; how well each feature
 * is proven lives separately in deviceEvidence.ts.
 */

import type { KeyboardConfig } from '../types/keyboard';
import { isRKWebSoftwareSupported } from './rkWebSoftware';

export const RK_VENDOR_ID = 0x258a;
export const CONFIG_USAGE_PAGE = 0x0001;
export const CONFIG_USAGE = 0x0080;
export const CLASSIC_REPORT_ID = 0x0a;
export const CLASSIC_REPORT_PAYLOAD_BYTES = 64;

export type DeviceFeature = 'keymap' | 'globalLighting' | 'perKeyColor';

/** The parts of a WebHID device this module reads. Collections are available before open(). */
export interface DeviceDescriptor {
  vendorId: number;
  productId: number;
  collections: readonly HIDCollectionInfo[];
}

export type IncompatibleReason =
  | 'wrong-vendor'
  | 'no-config-interface'
  | 'missing-feature-report'
  | 'wrong-report-size'
  | 'unknown-pid'
  | 'no-keys';

export type ReportShapeResult =
  | { ok: true }
  | { ok: false; reason: Extract<IncompatibleReason, 'wrong-vendor' | 'no-config-interface' | 'missing-feature-report' | 'wrong-report-size'>; detail: string };

export interface ClassicCapabilities {
  keymap: boolean;
  globalLighting: boolean;
  perKeyColor: boolean;
  /** Firmware mode index that displays per-key colors, or null when not established for this variant. */
  customLightingMode: number | null;
}

export type DeviceClassification =
  | { supported: true; family: 'classic'; pid: string; capabilities: ClassicCapabilities }
  | { supported: false; pid: string; reason: IncompatibleReason; detail: string; guidance: string };

/**
 * Explicit per-variant metadata, keyed by lowercase 4-digit PID.
 * Only add a variant with matching evidence; never infer from a model name,
 * the RGB flag, or a translated mode label alone.
 */
/** A collection usage that may carry the classic feature report 0x0A. */
export interface InterfaceSignature {
  usagePage: number;
  usage: number;
}

/** The configuration interface assumed for every classic config without variant evidence. */
export const DEFAULT_CONFIG_INTERFACE: InterfaceSignature = { usagePage: CONFIG_USAGE_PAGE, usage: CONFIG_USAGE };

export interface ClassicVariant {
  customLightingMode: number;
  /**
   * Additional configuration-interface usages observed through WebHID for this
   * exact PID. The default 0001:0080 signature is always accepted as well.
   */
  observedConfigInterfaces?: readonly InterfaceSignature[];
}

export const CLASSIC_VARIANT_METADATA: Readonly<Record<string, ClassicVariant>> = {
  '0055': {
    // 258A:0055 RK61: KB.ini RGBKb=1 + LedOpt14; en/led.xml tc_led_mode14 = "Customize".
    // Custom mode 14 per-key color was physically verified on USB in 2026-11; per-feature
    // evidence and its limits live in deviceEvidence.ts.
    customLightingMode: 14,
    // Observed in Chrome WebHID 2026-11-01 (USB): no 0001:0080 collection is exposed; the
    // 64-byte feature report 0x0A sits on a vendor-defined FF00:0001 application collection.
    // Descriptor evidence only, not proof of keymap or lighting behavior.
    observedConfigInterfaces: [{ usagePage: 0xff00, usage: 0x0001 }],
  },
};

export function formatPid(productId: number): string {
  return productId.toString(16).padStart(4, '0').toLowerCase();
}

/** Accepted configuration-interface usages for an exact PID. */
export function configInterfacesFor(pid: string): readonly InterfaceSignature[] {
  return [DEFAULT_CONFIG_INTERFACE, ...(CLASSIC_VARIANT_METADATA[pid.toLowerCase()]?.observedConfigInterfaces ?? [])];
}

/** WebHID picker filters: the default interface for any RK PID, plus each variant's observed interfaces for that PID only. */
export function classicRequestFilters(): HIDDeviceFilter[] {
  const filters: HIDDeviceFilter[] = [{ vendorId: RK_VENDOR_ID, ...DEFAULT_CONFIG_INTERFACE }];
  for (const [pid, variant] of Object.entries(CLASSIC_VARIANT_METADATA)) {
    for (const sig of variant.observedConfigInterfaces ?? []) {
      filters.push({ vendorId: RK_VENDOR_ID, productId: parseInt(pid, 16), ...sig });
    }
  }
  return filters;
}

/** Depth-first search of all collections (including nested children) for any of the given usages. */
export function findConfigCollections(
  collections: readonly HIDCollectionInfo[],
  signatures: readonly InterfaceSignature[] = [DEFAULT_CONFIG_INTERFACE]
): HIDCollectionInfo[] {
  const found: HIDCollectionInfo[] = [];
  const visit = (list: readonly HIDCollectionInfo[] | undefined) => {
    for (const c of list ?? []) {
      if (signatures.some(s => c.usagePage === s.usagePage && c.usage === s.usage)) found.push(c);
      visit(c.children);
    }
  };
  visit(collections);
  return found;
}

/** Cheap pre-filter: does an RK device expose a configuration interface accepted for its PID? */
export function hasClassicConfigInterface(device: DeviceDescriptor): boolean {
  return (
    device.vendorId === RK_VENDOR_ID &&
    findConfigCollections(device.collections, configInterfacesFor(formatPid(device.productId))).length > 0
  );
}

function featureReportsIn(collection: HIDCollectionInfo): HIDReportInfo[] {
  const reports = [...(collection.featureReports ?? [])];
  for (const child of collection.children ?? []) reports.push(...featureReportsIn(child));
  return reports;
}

/** Payload size in bits declared by a report's items (excludes the report ID byte). */
export function reportPayloadBits(report: HIDReportInfo): number {
  return (report.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
}

const hex = (n: number | undefined, width: number) => (n === undefined ? null : `0x${n.toString(16).padStart(width, '0')}`);

function summarizeCollection(c: HIDCollectionInfo): unknown {
  return {
    usagePage: hex(c.usagePage, 4),
    usage: hex(c.usage, 4),
    type: c.type ?? null,
    featureReports: (c.featureReports ?? []).map(r => ({
      reportId: hex(r.reportId, 2),
      payloadBits: reportPayloadBits(r),
      items: (r.items ?? []).map(i => ({ reportSize: i.reportSize ?? null, reportCount: i.reportCount ?? null })),
    })),
    inputReportIds: (c.inputReports ?? []).map(r => hex(r.reportId, 2)),
    outputReportIds: (c.outputReports ?? []).map(r => hex(r.reportId, 2)),
    children: (c.children ?? []).map(summarizeCollection),
  };
}

/**
 * Descriptor-structure summary for development diagnostics: VID/PID and the
 * recursive collection tree with report IDs and item sizes only. Never includes
 * serial number, product name, report contents or input data.
 */
export function summarizeDescriptor(device: DeviceDescriptor): string {
  return JSON.stringify({
    vendorId: hex(device.vendorId, 4),
    productId: hex(device.productId, 4),
    collections: device.collections.map(summarizeCollection),
  });
}

/** Check the descriptor for the classic writable interface. A normal keyboard collection alone fails. */
export function checkClassicReportShape(device: DeviceDescriptor): ReportShapeResult {
  if (device.vendorId !== RK_VENDOR_ID) {
    return { ok: false, reason: 'wrong-vendor', detail: `Vendor 0x${device.vendorId.toString(16)} is not 0x258a` };
  }
  const signatures = configInterfacesFor(formatPid(device.productId));
  const configCollections = findConfigCollections(device.collections, signatures);
  if (configCollections.length === 0) {
    const expected = signatures.map(s => `${hex(s.usagePage, 4)}:${hex(s.usage, 4)}`).join(' or ');
    return { ok: false, reason: 'no-config-interface', detail: `No ${expected} collection` };
  }
  const reports = configCollections.flatMap(featureReportsIn);
  const matching = reports.filter(r => r.reportId === CLASSIC_REPORT_ID);
  if (matching.length === 0) {
    const ids = reports.map(r => `0x${(r.reportId ?? 0).toString(16)}`).join(', ') || 'none';
    return { ok: false, reason: 'missing-feature-report', detail: `No feature report 0x0a (found: ${ids})` };
  }
  const expectedBits = CLASSIC_REPORT_PAYLOAD_BYTES * 8;
  if (!matching.some(r => reportPayloadBits(r) === expectedBits)) {
    const sizes = matching.map(r => `${reportPayloadBits(r) / 8} bytes`).join(', ');
    return { ok: false, reason: 'wrong-report-size', detail: `Feature report 0x0a is ${sizes}, expected ${CLASSIC_REPORT_PAYLOAD_BYTES}` };
  }
  return { ok: true };
}

/** Capabilities from the loaded configuration plus explicit variant metadata. */
export function deriveCapabilities(config: KeyboardConfig): ClassicCapabilities {
  const pid = config.pid.toLowerCase();
  const variant = CLASSIC_VARIANT_METADATA[pid];
  const customLightingMode =
    variant && config.rgb && config.keys.length > 0 && config.lightingModes.some(m => m.index === variant.customLightingMode)
      ? variant.customLightingMode
      : null;
  return {
    keymap: config.keys.length > 0,
    globalLighting: config.lightEnabled,
    perKeyColor: customLightingMode !== null,
    customLightingMode,
  };
}

const GUIDANCE: Record<IncompatibleReason, string> = {
  'wrong-vendor': 'This device is not a Royal Kludge keyboard.',
  'no-config-interface':
    'This interface is not the RK configuration interface. Connect the keyboard by USB cable and choose its configuration entry in the browser picker.',
  'missing-feature-report':
    'This keyboard uses a different protocol than the classic RK driver supports. No settings were sent.',
  'wrong-report-size':
    'This keyboard reports a different configuration format than the classic RK driver supports. No settings were sent.',
  'unknown-pid': 'No configuration for this exact model is included, so no settings can be sent safely.',
  'no-keys': 'The configuration for this model has no usable key layout, so no settings can be sent safely.',
};

function officialHint(pid: string): string {
  return isRKWebSoftwareSupported(pid)
    ? ' This model appears in a February 2026 snapshot of the official RK web software list; that list is a dated hint, not verified here.'
    : '';
}

function rejected(pid: string, reason: IncompatibleReason, detail: string): DeviceClassification {
  const officialRelevant = reason !== 'wrong-vendor' && reason !== 'no-config-interface';
  return { supported: false, pid, reason, detail, guidance: GUIDANCE[reason] + (officialRelevant ? officialHint(pid) : '') };
}

/**
 * Combine descriptor signature, exact VID/PID and the loaded configuration.
 * `config` must be the configuration loaded for this device's PID, or null if none exists.
 */
export function classifyDevice(device: DeviceDescriptor, config: KeyboardConfig | null): DeviceClassification {
  const pid = formatPid(device.productId);
  const shape = checkClassicReportShape(device);
  if (!shape.ok) return rejected(pid, shape.reason, shape.detail);
  if (!config || config.pid.toLowerCase() !== pid) {
    return rejected(pid, 'unknown-pid', `No shipped configuration for PID ${pid}`);
  }
  if (config.keys.length === 0) return rejected(pid, 'no-keys', `Configuration for PID ${pid} has no keys`);
  return { supported: true, family: 'classic', pid, capabilities: deriveCapabilities(config) };
}
