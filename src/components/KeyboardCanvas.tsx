import { useState, useRef } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { PerKeyColors } from '../models/LightingCodec';
import type { FirmwareCode } from '../types/keycode';
import type { Key } from '../types/keyboard';
import type { KeyBox } from '../utils/keyboardGeometry';
import { shortLegend } from '../utils/keyboardGeometry';
import { getLocaleLabel } from '../utils/localeLabels';
import { firmwareCodeLabel } from '../utils/keyChords';
import { toHex } from '../utils/lightingPalettes';
import { KeyboardBoard, type KeyState } from './KeyboardBoard';

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
  /** Draw the keyboard as a picture with no key buttons (lighting without per-key colors). */
  readOnly?: boolean;
}

function rgbCss(c: { r: number; g: number; b: number }): string {
  return `rgb(${c.r}, ${c.g}, ${c.b})`;
}

function center(box: KeyBox): [number, number] {
  return [box.x + box.w / 2, box.y + box.h / 2];
}

/** Nearest key in an arrow direction, from the board layout. */
function neighbor(keys: Key[], boxes: Record<number, KeyBox>, from: Key, dir: 'left' | 'right' | 'up' | 'down'): Key | null {
  const fromBox = boxes[from.bIndex];
  if (!fromBox) return null;
  const [fx, fy] = center(fromBox);
  let best: Key | null = null;
  let bestScore = Infinity;
  for (const k of keys) {
    const box = boxes[k.bIndex];
    if (k === from || !box) continue;
    const [x, y] = center(box);
    const dx = x - fx;
    const dy = y - fy;
    const primary = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
    const secondary = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (primary <= 0.1) continue;
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
  readOnly = false,
}: KeyboardCanvasProps) {
  const [focusedKey, setFocusedKey] = useState<number | null>(null);
  const keyRefs = useRef(new Map<number, HTMLButtonElement>());
  const lastPointerType = useRef<string>('mouse');

  const { config } = device;
  const { layout } = config;
  const colorView = keyColors !== undefined;
  const locale = config.locale;
  const drawn = config.keys.filter(k => layout.keys[k.bIndex]);

  const tabStop = focusedKey ?? selectedKeyIndex ?? drawn[0]?.bIndex;

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
      const next = neighbor(drawn, layout.keys, key, dir);
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

  // Per-key state and accessible name
  const describe = (key: Key): { state: KeyState; selected: boolean; label: string } => {
    const b = key.bIndex;
    const name = keyName(key);
    if (colorView) {
      const color = keyColors[b];
      const pending = !!appliedColors && !!color && (() => {
        const a = appliedColors[b];
        return !a || a.r !== color.r || a.g !== color.g || a.b !== color.b;
      })();
      return {
        state: pending ? 'pending' : 'default',
        selected: !!selectedKeys?.has(b),
        label: `${name}, color ${color ? toHex(color) : 'unset'}${pending ? ', pending' : ''}`,
      };
    }
    const applied = device.getMapping(b);
    const draft = draftMappings ? draftMappings.get(b) : applied;
    const pending = !!draftMappings && draft !== applied;
    return {
      state: pending ? 'pending' : draft !== undefined ? 'remapped' : 'default',
      selected: selectedKeyIndex === b,
      label: `${name}${draft !== undefined ? `, remapped to ${firmwareCodeLabel(draft, 'mac')}` : ''}${pending ? ', pending' : ''}`,
    };
  };

  const activation = (e: React.MouseEvent | React.PointerEvent): KeyActivation => ({
    additive: e.shiftKey || e.metaKey || e.ctrlKey,
  });

  // A few RK files use a key format this app can't read; there is nothing to draw or select
  if (drawn.length === 0) {
    return (
      <div className="keyboard-canvas kb-plate grid min-h-40 place-items-center">
        <p className="rounded-full bg-[var(--kb-cap)] px-4 py-2 text-sm font-semibold text-[var(--kb-legend)]">
          Key remapping: Not available — no key layout
        </p>
      </div>
    );
  }

  return (
    <div className={`keyboard-canvas min-w-0 ${disabled ? 'opacity-70' : ''}`}>
      <p className="sm:hidden mb-2 text-xs text-muted-foreground">↔ Scroll keyboard sideways to reach every key</p>
      <div className="kb-scroll overflow-x-auto">
        <div className="kb-plate" style={{ minWidth: `${Math.ceil(layout.width * MIN_KEY_PX) + 32}px` }}>
          <div role={readOnly ? 'img' : 'group'} aria-label={ariaLabel ?? `${config.name} keys`}>
            <KeyboardBoard
              layout={layout}
              keys={drawn}
              mode={colorView ? 'lighting' : 'keys'}
              legendFor={key => shortLegend(keyName(key))}
              ledFor={colorView ? key => (keyColors[key.bIndex] ? rgbCss(keyColors[key.bIndex]) : undefined) : undefined}
              stateFor={readOnly ? undefined : key => describe(key).state}
              isSelected={readOnly ? undefined : key => describe(key).selected}
              buttonProps={readOnly ? undefined : key => {
                const b = key.bIndex;
                const { selected, label } = describe(key);
                return {
                  ref: (el: HTMLButtonElement | null) => {
                    if (el) keyRefs.current.set(b, el);
                    else keyRefs.current.delete(b);
                  },
                  tabIndex: b === tabStop ? 0 : -1,
                  'aria-label': label,
                  'aria-pressed': selected,
                  'aria-disabled': disabled || undefined,
                  onFocus: () => setFocusedKey(b),
                  onKeyDown: e => handleKeyDown(key, e),
                  onPointerDown: e => {
                    lastPointerType.current = e.pointerType;
                    if (disabled || e.pointerType !== 'mouse' || e.button !== 0 || !onKeyMouseDown) return;
                    e.preventDefault();
                    setFocusedKey(b);
                    onKeyMouseDown(b, activation(e));
                  },
                  onPointerEnter: e => {
                    if (disabled || e.pointerType !== 'mouse' || (e.buttons & 1) === 0) return;
                    onKeyMouseDrag?.(b);
                  },
                  onClick: e => {
                    if (disabled) return;
                    // Mouse presses were already handled on pointerdown when a drag handler exists.
                    if (onKeyMouseDown && lastPointerType.current === 'mouse') return;
                    setFocusedKey(b);
                    onKeyClick?.(b, activation(e));
                  },
                  style: colorView ? { touchAction: 'pan-x' } : undefined,
                };
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Key state legend for the stage (keys or color view); swatches use the keyboard's own colours. */
export function KeyboardLegend({ colorView }: { colorView?: boolean }) {
  const item = 'inline-flex items-center gap-1.5';
  const swatch = 'inline-block size-3 rounded-[4px] border';
  return (
    <div className="kb-legend float flex flex-wrap gap-x-3.5 gap-y-1.5 rounded-full px-3.5 py-2.5 text-xs text-card-foreground">
      {colorView ? (
        <>
          <span className={item}>
            <i aria-hidden="true" className={`${swatch} border-2 border-dashed border-primary bg-[var(--kb-cap)]`} />
            Selected (dashed outline)
          </span>
          <span className={item}>
            <i aria-hidden="true" className="inline-block size-3 rounded-full bg-[var(--kb-amber)]" />
            Pending color (not sent yet)
          </span>
        </>
      ) : (
        <>
          <span className={item}>
            <i aria-hidden="true" className={`${swatch} border-[var(--kb-ledge)] bg-[var(--kb-cap)]`} />
            Default
          </span>
          <span className={item}>
            <i aria-hidden="true" className={`${swatch} border-[var(--kb-green)] bg-[color-mix(in_srgb,var(--kb-green)_16%,var(--kb-cap))]`} />
            Remapped (last sent)
          </span>
          <span className={item}>
            <i aria-hidden="true" className={`${swatch} border-[var(--kb-amber-d)] bg-[color-mix(in_srgb,#fbbf24_40%,var(--kb-cap))]`} />
            Pending (not sent yet)
          </span>
          <span className={item}>
            <i aria-hidden="true" className={`${swatch} border-2 border-primary bg-[var(--kb-cap)]`} />
            Selected
          </span>
        </>
      )}
    </div>
  );
}
