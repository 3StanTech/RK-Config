import type { CSSProperties } from 'react';

/**
 * Decorative RK61 for the home hero, drawn in code with the built-in WASD palette.
 * Static by design: no device data, no interaction. The editor's KB.ini-driven
 * renderer replaces it later and reuses the .kb-hero colour tokens.
 */

interface HeroKey {
  id: string;
  label: string;
  /** Width in key units (1u = one standard key). */
  w: number;
}

const k = (id: string, label: string, w = 1): HeroKey => ({ id, label, w });

// 61 keys, 15u per row; legends follow the factory keycaps.
const LAYOUT: HeroKey[][] = [
  [k('esc', 'Esc'), k('1', '1'), k('2', '2'), k('3', '3'), k('4', '4'), k('5', '5'), k('6', '6'), k('7', '7'), k('8', '8'), k('9', '9'), k('0', '0'), k('minus', '-'), k('equal', '='), k('bksp', 'Backspace', 2)],
  [k('tab', 'Tab', 1.5), k('q', 'Q'), k('w', 'W'), k('e', 'E'), k('r', 'R'), k('t', 'T'), k('y', 'Y'), k('u', 'U'), k('i', 'I'), k('o', 'O'), k('p', 'P'), k('lbr', '['), k('rbr', ']'), k('bslash', '\\', 1.5)],
  [k('caps', 'Caps', 1.75), k('a', 'A'), k('s', 'S'), k('d', 'D'), k('f', 'F'), k('g', 'G'), k('h', 'H'), k('j', 'J'), k('k', 'K'), k('l', 'L'), k('semi', ';'), k('quote', "'"), k('enter', 'Enter', 2.25)],
  [k('lshift', 'Shift', 2.25), k('z', 'Z'), k('x', 'X'), k('c', 'C'), k('v', 'V'), k('b', 'B'), k('n', 'N'), k('m', 'M'), k('comma', ','), k('dot', '.'), k('slash', '/'), k('rshift', 'Shift', 2.75)],
  [k('lctrl', 'Ctrl', 1.25), k('lwin', 'Win', 1.25), k('lalt', 'Alt', 1.25), k('space', '', 6.25), k('ralt', 'Alt', 1.25), k('menu', 'Menu', 1.25), k('rctrl', 'Ctrl', 1.25), k('fn', 'Fn', 1.25)],
];

// Built-in WASD palette: W, A, S, D blue, every other key white.
const WASD = new Set(['w', 'a', 's', 'd']);
const ledColor = (id: string) => (WASD.has(id) ? '#0000FF' : '#FFFFFF');

export function HeroKeyboard() {
  return (
    <div
      className="kb-hero"
      role="img"
      aria-label="RK61 keyboard with W, A, S and D lit blue and the other keys white"
    >
      {LAYOUT.map((row, r) => (
        <div className="kb-row" key={r}>
          {row.map((key) => (
            <span
              key={key.id}
              className="kb-key"
              style={{ gridColumn: `span ${Math.round(key.w * 4)}`, '--led': ledColor(key.id) } as CSSProperties}
            >
              <span className="kb-cap">
                <span className="kb-l">{key.label}</span>
              </span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
