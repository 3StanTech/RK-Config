import type { Key } from '../types/keyboard';
import type { BoardLayout } from '../utils/keyboardGeometry';
import { KeyboardBoard } from './KeyboardBoard';
import { shortLegend } from '../utils/keyboardGeometry';
import { wasdPalette } from '../utils/lightingPalettes';

/** Keys and layout of the hero model, computed at build time (heroBoard.server.ts). */
export interface HeroBoard {
  keys: Key[];
  layout: BoardLayout;
}

/**
 * Decorative RK61 for the home hero, drawn by the editor's renderer from 0055's KB.ini,
 * lit with the built-in WASD palette. No interaction.
 */
export function HeroKeyboard({ board }: { board: HeroBoard }) {
  const colors = wasdPalette(board);
  return (
    <KeyboardBoard
      className="kb-hero"
      layout={board.layout}
      keys={board.keys}
      mode="hero"
      legendFor={key => shortLegend(key.keyInfo.label)}
      ledFor={key => {
        const c = colors[key.bIndex];
        return c ? `rgb(${c.r}, ${c.g}, ${c.b})` : undefined;
      }}
      boardProps={{ role: 'img', 'aria-label': 'RK61 keyboard with W, A, S and D lit blue and the other keys white' }}
    />
  );
}
