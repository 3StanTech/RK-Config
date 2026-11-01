import { useState, useEffect, useRef, useMemo } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { PerKeyColors } from '../models/LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import type { Key } from '../types/keyboard';
import type { ImageManifest } from '../utils/buildImageManifest';
import { getKeyBackgrounds } from '../utils/luminance';
import { getLocaleLabel } from '../utils/localeLabels';
import { firmwareCodeLabel } from '../utils/keyChords';

/** Minimum on-screen size of a 1U key; narrower containers scroll sideways. */
const MIN_KEY_PX = 44;

export interface KeyActivation {
  /** Shift, Command or Ctrl held: add to the selection instead of replacing it. */
  additive: boolean;
}

interface KeyboardCanvasProps {
  device: KeyboardDevice;
  onKeyClick?: (keyIndex: number, activation: KeyActivation) => void;
  selectedKeyIndex?: number;
  imageManifest?: ImageManifest;
  /** Accessible name of the key group. */
  ariaLabel?: string;
  /**
   * Draft keymap. When given, keys whose draft differs from the last applied
   * mapping are shown as pending; otherwise applied mappings are shown.
   */
  draftMappings?: Map<number, FirmwareCode>;
  /** Per-key color view: draft colors to paint on each key. */
  keyColors?: PerKeyColors;
  /** Last applied colors, to mark keys whose draft color is pending. */
  appliedColors?: PerKeyColors;
  /** Multi-selection (color view). */
  selectedKeys?: ReadonlySet<number>;
  disabled?: boolean;
  /** Mouse press on a key (drag start). Touch and pen use onKeyClick only, so swipes scroll. */
  onKeyMouseDown?: (keyIndex: number, activation: KeyActivation) => void;
  /** Mouse moved onto a key while a button is held (drag). */
  onKeyMouseDrag?: (keyIndex: number) => void;
  /** Space or Enter on the focused key. Defaults to onKeyClick. */
  onKeyAction?: (keyIndex: number, action: 'space' | 'enter') => void;
  /** Shift+Arrow moved focus to another key (extend selection). */
  onKeyExtend?: (keyIndex: number) => void;
}

function rgbCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function hex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function center(key: Key): [number, number] {
  return [(key.rect[0] + key.rect[2]) / 2, (key.rect[1] + key.rect[3]) / 2];
}

/** Nearest key in an arrow direction, from factory geometry. */
function neighbor(keys: Key[], from: Key, dir: 'left' | 'right' | 'up' | 'down'): Key | null {
  const [fx, fy] = center(from);
  let best: Key | null = null;
  let bestScore = Infinity;
  for (const k of keys) {
    if (k === from) continue;
    const [x, y] = center(k);
    const dx = x - fx;
    const dy = y - fy;
    const primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (primary <= 1) continue;
    const score = primary + secondary * 3;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

export function KeyboardCanvas({
  device,
  onKeyClick,
  selectedKeyIndex,
  imageManifest,
  ariaLabel,
  draftMappings,
  keyColors,
  appliedColors,
  selectedKeys,
  disabled = false,
  onKeyMouseDown,
  onKeyMouseDrag,
  onKeyAction,
  onKeyExtend,
}: KeyboardCanvasProps) {
  const [imgWidth, setImgWidth] = useState(0);
  const [imgHeight, setImgHeight] = useState(0);
  const [focusedKey, setFocusedKey] = useState<number | null>(null);
  const keyRefs = useRef(new Map<number, SVGGElement>());
  const lastPointerType = useRef<string>('mouse');
  const [keyBackgrounds] = useState<Map<number, string>>(() =>
    // Calculate key backgrounds once on mount
    getKeyBackgrounds(device.config.pid, device.config.keys, imageManifest)
  );

  // Load image to get dimensions
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImgWidth(img.width);
      setImgHeight(img.height);
    };
    img.src = device.config.imageUrl;
  }, [device.config.imageUrl]);

  const { config } = device;
  const colorView = keyColors !== undefined;
  const locale = config.locale;

  // Width at which a 1U key renders at MIN_KEY_PX; narrower containers scroll.
  const minCanvasWidth = useMemo(() => {
    const widths = config.keys.map(k => k.rect[2] - k.rect[0]).filter(w => w > 0);
    if (!imgWidth || widths.length === 0) return 0;
    const unit = Math.min(...widths);
    return Math.ceil((imgWidth * MIN_KEY_PX) / unit);
  }, [config.keys, imgWidth]);

  const tabStop = focusedKey ?? selectedKeyIndex ?? config.keys[0]?.bIndex;

  const keyName = (key: Key) => getLocaleLabel(key.keyInfo.vk, locale) || key.keyInfo.label;

  const moveFocus = (to: Key) => {
    setFocusedKey(to.bIndex);
    keyRefs.current.get(to.bIndex)?.focus();
  };

  const handleKeyDown = (key: Key, e: React.KeyboardEvent) => {
    const dirs: Record<string, 'left' | 'right' | 'up' | 'down'> = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
    };
    const dir = dirs[e.key];
    if (dir) {
      e.preventDefault();
      const next = neighbor(config.keys, key, dir);
      if (next) {
        moveFocus(next);
        if (e.shiftKey && !disabled) onKeyExtend?.(next.bIndex);
      }
      return;
    }
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const action = e.key === ' ' ? 'space' : 'enter';
      if (onKeyAction) onKeyAction(key.bIndex, action);
      else onKeyClick?.(key.bIndex, { additive: false });
    }
  };

  const renderKeyBackground = (key: Key, index: number) => {
    const backgroundColor = keyBackgrounds.get(key.bIndex);
    if (!backgroundColor) return null;

    const [left, top, right, bottom] = key.rect;

    return (
      <rect
        key={`bg-${index}`}
        x={left}
        y={top}
        width={right - left}
        height={bottom - top}
        fill={backgroundColor}
      />
    );
  };

  const renderKey = (key: Key, index: number) => {
    const b = key.bIndex;
    const [left, top, right, bottom] = key.rect;
    const w = right - left;
    const h = bottom - top;
    const markR = Math.max(3, Math.min(w, h) * 0.1);
    const name = keyName(key);

    let keyClass: string;
    let pending = false;
    let selected: boolean;
    let label: string;
    let fill: string | undefined;

    if (colorView) {
      const color = keyColors[b];
      selected = !!selectedKeys?.has(b);
      pending = !!appliedColors && !!color && (() => {
        const a = appliedColors[b];
        return !a || a.r !== color.r || a.g !== color.g || a.b !== color.b;
      })();
      keyClass = selected ? 'key-color key-color-selected' : 'key-color';
      fill = color ? rgbCss(color) : undefined;
      label = `${name}, color ${color ? hex(color) : 'unset'}${pending ? ', pending' : ''}`;
    } else {
      const applied = device.getMapping(b);
      const draft = draftMappings ? draftMappings.get(b) : applied;
      pending = !!draftMappings && draft !== applied;
      selected = selectedKeyIndex === b;
      keyClass = selected ? 'key-selected' : pending ? 'key-pending' : draft !== undefined ? 'key-remapped' : 'key-default';
      label = `${name}${draft !== undefined ? `, remapped to ${firmwareCodeLabel(draft, 'mac')}` : ''}${pending ? ', pending' : ''}`;
    }

    const activation = (e: React.MouseEvent | React.PointerEvent): KeyActivation => ({
      additive: e.shiftKey || e.metaKey || e.ctrlKey,
    });

    return (
      <g
        key={index}
        ref={el => {
          if (el) keyRefs.current.set(b, el);
          else keyRefs.current.delete(b);
        }}
        role="button"
        tabIndex={b === tabStop ? 0 : -1}
        aria-label={label}
        aria-pressed={selected}
        aria-disabled={disabled || undefined}
        className={`kb-key ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        onFocus={() => setFocusedKey(b)}
        onKeyDown={e => handleKeyDown(key, e)}
        onPointerDown={e => {
          lastPointerType.current = e.pointerType;
          if (disabled || e.pointerType !== 'mouse' || e.button !== 0 || !onKeyMouseDown) return;
          e.preventDefault();
          setFocusedKey(b);
          onKeyMouseDown(b, activation(e));
        }}
        onPointerEnter={e => {
          if (disabled || e.pointerType !== 'mouse' || (e.buttons & 1) === 0) return;
          onKeyMouseDrag?.(b);
        }}
        onClick={e => {
          if (disabled) return;
          // Mouse presses were already handled on pointerdown when a drag handler exists.
          if (onKeyMouseDown && lastPointerType.current === 'mouse') return;
          setFocusedKey(b);
          onKeyClick?.(b, activation(e));
        }}
      >
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          className={`${keyClass} transition-colors hover:opacity-80`}
          style={fill ? { fill } : undefined}
        />
        {pending && (
          <circle
            cx={right - markR * 1.6}
            cy={top + markR * 1.6}
            r={markR}
            className="key-pending-mark"
          />
        )}
        {selected && (
          <rect
            x={left + 3}
            y={top + 3}
            width={Math.max(0, w - 6)}
            height={Math.max(0, h - 6)}
            className="key-selected-ring"
          />
        )}
      </g>
    );
  };

  if (!imgWidth || !imgHeight) {
    return <div className="flex items-center justify-center h-64 border border-border rounded bg-muted">
      <p className="text-muted-foreground">Loading keyboard...</p>
    </div>;
  }

  return (
    <div className={`border border-border rounded p-4 bg-card keyboard-canvas ${disabled ? 'opacity-70' : ''}`}>
      <style>{`
        .keyboard-canvas {
          --key-default-fill: rgba(243, 244, 246, 0.3);
          --key-default-stroke: #9ca3af;
          --key-remapped-fill: rgba(187, 247, 208, 0.5);
          --key-remapped-stroke: #4ade80;
          --key-pending-fill: rgba(251, 191, 36, 0.35);
          --key-pending-stroke: #d97706;
          --key-selected-fill: rgba(59, 130, 246, 0.5);
          --key-selected-stroke: #2563eb;
        }
        .dark .keyboard-canvas {
          --key-default-fill: rgba(243, 244, 246, 0.3);
          --key-default-stroke: #9ca3af;
          --key-remapped-fill: rgba(74, 222, 128, 0.4);
          --key-remapped-stroke: #4ade80;
          --key-pending-fill: rgba(251, 191, 36, 0.3);
          --key-pending-stroke: #f59e0b;
          --key-selected-fill: rgba(59, 130, 246, 0.5);
          --key-selected-stroke: #2563eb;
        }
        .key-default {
          fill: var(--key-default-fill);
          stroke: var(--key-default-stroke);
          stroke-width: 1;
        }
        .key-remapped {
          fill: var(--key-remapped-fill);
          stroke: var(--key-remapped-stroke);
          stroke-width: 1;
        }
        .key-pending {
          fill: var(--key-pending-fill);
          stroke: var(--key-pending-stroke);
          stroke-width: 2;
        }
        .key-selected {
          fill: var(--key-selected-fill);
          stroke: var(--key-selected-stroke);
          stroke-width: 1;
        }
        .key-color {
          fill-opacity: 0.75;
          stroke: var(--key-default-stroke);
          stroke-width: 1;
        }
        .key-color-selected {
          stroke: var(--key-selected-stroke);
          stroke-width: 3;
        }
        .key-selected-ring {
          fill: none;
          stroke: var(--key-selected-stroke);
          stroke-width: 2;
          stroke-dasharray: 5 3;
          pointer-events: none;
        }
        .key-pending-mark {
          fill: var(--key-pending-stroke);
          stroke: #fff;
          stroke-width: 1;
          pointer-events: none;
        }
        .kb-key { outline: none; }
        .kb-key:focus-visible > rect:first-child {
          stroke: var(--ring);
          stroke-width: 4;
        }
        .keyboard-canvas .color-view .kb-key { touch-action: pan-x; }
        .legend-default {
          background-color: var(--key-default-fill);
          border-color: var(--key-default-stroke);
        }
        .legend-remapped {
          background-color: var(--key-remapped-fill);
          border-color: var(--key-remapped-stroke);
        }
        .legend-pending {
          background-color: var(--key-pending-fill);
          border-color: var(--key-pending-stroke);
        }
        .legend-selected {
          background-color: var(--key-selected-fill);
          border-color: var(--key-selected-stroke);
        }
      `}</style>
      <p className="sm:hidden text-xs text-muted-foreground mb-2">↔ Scroll keyboard sideways to reach every key</p>
      <div className="overflow-x-auto">
        <div style={{ minWidth: minCanvasWidth ? `${minCanvasWidth}px` : undefined }}>
          <svg
            viewBox={`0 0 ${imgWidth} ${imgHeight}`}
            className={`w-full h-auto ${colorView ? 'color-view' : ''}`}
            style={{ maxHeight: '400px' }}
            role="group"
            aria-label={ariaLabel ?? `${config.name} keys`}
          >
            {/* Render background rectangles behind keyboard image */}
            {config.keys.map((key, index) => renderKeyBackground(key, index))}
            <image
              href={config.imageUrl}
              x="0"
              y="0"
              width={imgWidth}
              height={imgHeight}
              className="dark:opacity-80"
            />
            {/* Render key overlays on top */}
            {config.keys.map((key, index) => renderKey(key, index))}
          </svg>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-card-foreground">
        {colorView ? (
          <>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1" y="1" width="14" height="14" fill="none" stroke="var(--key-selected-stroke)" strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              <span>Selected (dashed outline)</span>
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="5" fill="var(--key-pending-stroke)" />
              </svg>
              <span>Pending color (not sent yet)</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border legend-default"></div>
              <span>Default</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border legend-remapped"></div>
              <span>Remapped{draftMappings ? ' (last sent)' : ''}</span>
            </div>
            {draftMappings && (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border legend-pending"></div>
                <span>Pending (not sent yet, marked ●)</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border legend-selected"></div>
              <span>Selected</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
