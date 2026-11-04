/**
 * Build-time hero keyboard: the tested RK61 (0055) drawn from its own KB.ini.
 * Keep Node filesystem imports out of browser-reachable modules.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { decodeKBIni } from './keyboardImages';
import { parseKeySection, parseUnRectKey } from './kbIniParser';
import { layoutKeys } from './keyboardGeometry';
import type { HeroBoard } from '../components/HeroKeyboard';

export function loadHeroBoard(pid = '0055'): HeroBoard {
  const text = decodeKBIni(readFileSync(join(process.cwd(), 'public', 'rk', 'Dev', pid, 'KB.ini')));
  const keys = parseKeySection(text);
  return { keys, layout: layoutKeys(keys, parseUnRectKey(text)) };
}
