/**
 * Parse KB.ini files from RK software
 */

import ini from 'ini';
import { parseVK } from '../types/keycode';
import { LightingType, type Key, type KeyboardConfig, type LightingMode, type LightingModeFlags } from '../types/keyboard';
import { getDeviceName } from './rkConfig';
import { parseLedXml } from './ledXmlParser';
import { decodeKBIni } from './keyboardImages';
import { extractLocale } from './localeLabels';
import { layoutKeys } from './keyboardGeometry';

/**
 * Parse a single key entry from KB.ini
 * Format: left,top,right,bottom,flags,vkcode,unknown,bIndex
 */
function parseKeyEntry(value: string, keyName: string): Key | null {
  const parts = value.split(',').map(p => p.trim());
  if (parts.length !== 8) {
    console.error(`Invalid key entry format for ${keyName}: expected 8 parts, got ${parts.length}`, value);
    return null;
  }

  const keyInfo = parseVK(parts[5], parts[6]);
  if (!keyInfo) {
    console.warn(`Skipping unsupported key format ${keyName}: ${parts[5]}`);
    return null;
  }

  return {
    rect: [parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3])],
    keyInfo,
    bIndex: parseInt(parts[7]),
  };
}

/**
 * Parse LedOpt entry from KB.ini
 * Format: animation,speed,brightness,direction,random,colorpicker
 */
function parseLedOptEntry(value: string): LightingModeFlags | null {
  const parts = value.split(',').map(p => p.trim());
  if (parts.length !== 6) {
    console.error(`Invalid LedOpt format: expected 6 parts, got ${parts.length}`, value);
    return null;
  }

  return {
    animation: parts[0] === '1',
    speed: parts[1] === '1',
    brightness: parts[2] === '1',
    direction: parseInt(parts[3]),
    random: parts[4] === '1',
    colorPicker: parts[5] === '1',
  };
}

/**
 * Parse the [KEY] section of KB.ini text into keys
 */
export function parseKeySection(text: string): Key[] {
  const parsed = ini.parse(text);
  const keys: Key[] = [];
  if (!parsed.KEY) return keys;

  for (const [keyName, value] of Object.entries(parsed.KEY)) {
    if (!keyName.startsWith('K')) {
      continue;
    }

    if (typeof value !== 'string') {
      console.error(`Invalid value type for ${keyName}: expected string, got ${typeof value}`);
      continue;
    }

    const key = parseKeyEntry(value, keyName);
    if (key) keys.push(key);
  }
  return keys;
}

/**
 * ISO outline from an active `UnRectKey = id,x,y,x,y,…` line. Most files only carry it
 * as a commented-out template line (`;UnRectKey`), which is ignored.
 */
export function parseUnRectKey(text: string): number[] | null {
  const m = /^[ \t]*UnRectKey[ \t]*=[ \t]*([^\r\n]+)/im.exec(text);
  if (!m) return null;
  const nums = m[1].split(',').map(v => parseInt(v.trim(), 10));
  return nums.every(n => Number.isFinite(n)) ? nums : null;
}

/**
 * Try to fetch KB.ini handling case-sensitivity of directory names
 */
async function fetchKBIni(pid: string): Promise<{ text: string } | null> {
  // Try uppercase first (most common)
  let response = await fetch(`${import.meta.env.BASE_URL}rk/Dev/${pid.toUpperCase()}/KB.ini`);
  if (response.ok) {
    const buffer = await response.arrayBuffer();
    return { text: decodeKBIni(buffer) };
  }

  // Try lowercase
  response = await fetch(`${import.meta.env.BASE_URL}rk/Dev/${pid.toLowerCase()}/KB.ini`);
  if (response.ok) {
    const buffer = await response.arrayBuffer();
    return { text: decodeKBIni(buffer) };
  }

  return null;
}

/**
 * Parse KB.ini file for a specific keyboard PID
 */
export async function parseKBIni(pid: string, ledManifest: string | null = null): Promise<KeyboardConfig | null> {
  try {
    const kbIni = await fetchKBIni(pid);
    if (!kbIni) {
      console.warn(`KB.ini not found for PID ${pid}`);
      return null;
    }

    const text = kbIni.text;
    const parsed = ini.parse(text);

    if (!parsed.KEY) {
      console.warn(`No [KEY] section found in KB.ini for PID ${pid}`);
      return null;
    }

    const keys = parseKeySection(text);
    const layout = layoutKeys(keys, parseUnRectKey(text));

    // Parse lighting capabilities
    const rgb = parsed.OPT?.RGBKb === '1';
    const hasEft = parsed.OPT?.MaxEftKeyIndex !== undefined;
    const lightingModes: LightingMode[] = [];

    // Parse LedOpt entries
    if (parsed.OPT) {
      const ledOptEntries: Array<{ index: number; flags: LightingModeFlags }> = [];

      for (let i = 1; i <= 21; i++) {
        const ledOptKey = `LedOpt${i}`;
        const ledOptValue = parsed.OPT[ledOptKey];

        if (typeof ledOptValue === 'string') {
          const flags = parseLedOptEntry(ledOptValue);
          if (flags) {
            ledOptEntries.push({ index: i, flags });
          }
        }
      }

      // Get mode names from led.xml if we have any modes
      if (ledOptEntries.length > 0) {
        // Determine lighting type for parsing XML
        let xmlLightingType: LightingType;
        if (hasEft) {
          xmlLightingType = LightingType.EFT;
        } else if (rgb) {
          xmlLightingType = LightingType.RGB;
        } else {
          xmlLightingType = LightingType.Backlit;
        }

        const modeNames = await parseLedXml(pid, xmlLightingType, ledManifest);

        for (const { index, flags } of ledOptEntries) {
          lightingModes.push({
            index,
            name: modeNames.get(index) || `Mode ${index}`,
            flags,
          });
        }
      }
    }

    const lightEnabled = lightingModes.length > 0;

    // Determine lighting type
    let lightingType: LightingType;
    if (hasEft) {
      lightingType = LightingType.EFT;  // EFT takes priority (per-key reactive RGB)
    } else if (rgb) {
      lightingType = LightingType.RGB;  // Full keyboard RGB
    } else if (lightEnabled) {
      lightingType = LightingType.Backlit;  // Single-color backlight
    } else {
      lightingType = LightingType.None;  // No lighting
    }

    // Get device name from Cfg.ini
    const name = await getDeviceName(pid) || `RK ${pid.toUpperCase()}`;
    const locale = extractLocale(name);

    return {
      pid: pid.toLowerCase(),
      name,
      locale,
      keys,
      layout,
      lightEnabled,
      rgb,
      lightingType,
      lightingModes,
    };
  } catch (error) {
    console.error(`Failed to parse KB.ini for PID ${pid}:`, error);
    return null;
  }
}
