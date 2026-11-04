import type { ButtonHTMLAttributes, CSSProperties, Ref } from 'react';
import type { Key } from '../types/keyboard';
import type { BoardLayout } from '../utils/keyboardGeometry';

/**
 * Keyboard drawn in code from a model's normalised key layout, in the fixed
 * colourway (D5): dark board, cream caps with a ledge, legends in the theme font.
 * Used by the home hero (static) and the editor canvas (interactive).
 */

export type KeyState = 'default' | 'remapped' | 'pending';

export type KeyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: Ref<HTMLButtonElement> };

interface KeyboardBoardProps {
  layout: BoardLayout;
  keys: Key[];
  /** 'lighting' and 'hero' tint caps by their LED colour. */
  mode: 'hero' | 'keys' | 'lighting';
  legendFor: (key: Key) => string;
  /** CSS colour of the key's LED (lighting and hero). */
  ledFor?: (key: Key) => string | undefined;
  stateFor?: (key: Key) => KeyState;
  isSelected?: (key: Key) => boolean;
  /** Makes each key a button with these props; without it the keys are plain shapes. */
  buttonProps?: (key: Key) => KeyButtonProps;
  className?: string;
  /** Applied to the board element (the hero passes role="img" and its description). */
  boardProps?: { role?: string; 'aria-label'?: string };
}

export function KeyboardBoard({
  layout,
  keys,
  mode,
  legendFor,
  ledFor,
  stateFor,
  isSelected,
  buttonProps,
  className,
  boardProps,
}: KeyboardBoardProps) {
  const { width: W, height: H } = layout;

  return (
    <div
      className={`kb-board ${className ?? ''}`}
      data-mode={mode}
      style={{ aspectRatio: `${W} / ${H}`, '--kb-w': W } as CSSProperties}
      {...boardProps}
    >
      {keys.map(key => {
        const box = layout.keys[key.bIndex];
        if (!box) return null; // keys without a position on the board (zero-size rects) are not drawn
        const state = stateFor?.(key) ?? 'default';
        const selected = isSelected?.(key) ?? false;
        const led = ledFor?.(key);
        const style = {
          left: `${(box.x / W) * 100}%`,
          top: `${(box.y / H) * 100}%`,
          width: `${(box.w / W) * 100}%`,
          height: `${(box.h / H) * 100}%`,
          // ISO Enter's box covers its notch; clip it so the neighbouring key there gets its own clicks
          ...(box.shape ? { clipPath: `polygon(${box.shape.map(([x, y]) => `${(x / box.w) * 100}% ${(y / box.h) * 100}%`).join(', ')})` } : {}),
          ...(led ? { '--led': led } : {}),
        } as CSSProperties;
        const legend = legendFor(key);
        const cap = box.shape ? (
          <span className="kb-cap kb-iso">
            <svg viewBox={`-0.06 -0.06 ${box.w + 0.12} ${box.h + 0.12}`} preserveAspectRatio="none" aria-hidden="true">
              <polygon points={box.shape.map(([x, y]) => `${x},${y}`).join(' ')} vectorEffect="non-scaling-stroke" />
            </svg>
            <span className="kb-l">{legend}</span>
            {state === 'pending' && <span className="kb-pend" aria-hidden="true" />}
          </span>
        ) : (
          <span className="kb-cap">
            <span className="kb-l">{legend}</span>
            {state === 'pending' && <span className="kb-pend" aria-hidden="true" />}
          </span>
        );
        const data = { 'data-state': state, 'data-selected': selected || undefined, 'data-b': key.bIndex };

        if (!buttonProps) {
          return <span key={key.bIndex} className="kb-key" style={style} {...data}>{cap}</span>;
        }
        const { ref, style: extraStyle, ...props } = buttonProps(key);
        return (
          <button key={key.bIndex} ref={ref} type="button" className="kb-key" style={{ ...style, ...extraStyle }} {...data} {...props}>
            {cap}
          </button>
        );
      })}
    </div>
  );
}
