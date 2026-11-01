import { useState } from 'react';
import type { FirmwareCode } from '../types/keycode';
import {
  MODIFIERS,
  chordError,
  chordLabel,
  decodeChord,
  encodeChord,
  firmwareCodeLabel,
  getSupportedBaseKeys,
  modifierIdsFromMask,
  type KeyChord,
  type ModifierInfo,
} from '../utils/keyChords';
import { Badge } from '@/components/ui/badge';
import { TriangleAlert } from 'lucide-react';

const BASE_KEYS = getSupportedBaseKeys();

const KIND_CHIP: Record<ModifierInfo['kind'], string> = {
  ctrl: '⌃ Control',
  shift: '⇧ Shift',
  alt: '⌥ Option',
  gui: '⌘ Command',
};

function fwHex(code: FirmwareCode): string {
  return `0x${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

interface KeyChordComposerProps {
  /** The selected key's effective draft code (draft override or factory code). */
  value: FirmwareCode;
  /** Stage a new code. Only valid chords are reported. */
  onChange: (code: FirmwareCode) => void;
  disabled?: boolean;
}

/**
 * Explicit modifier/base-key controls. Left and right modifier bits are kept
 * separate and sent exactly as chosen; labels never change the bits.
 */
export function KeyChordComposer({ value, onChange, disabled = false }: KeyChordComposerProps) {
  const decoded = decodeChord(value);
  // Local edit state so an empty in-progress chord can be shown without staging it.
  const [editing, setEditing] = useState<{ source: FirmwareCode; chord: KeyChord } | null>(null);
  const chord: KeyChord | null = editing && editing.source === value ? editing.chord : decoded;
  const special = chord === null;

  const commit = (next: KeyChord) => {
    if (chordError(next)) {
      setEditing({ source: value, chord: next });
      return;
    }
    setEditing(null);
    onChange(encodeChord(next));
  };

  const toggleModifier = (bit: number) => {
    const base = chord ?? { modifiers: 0, base: null };
    commit({ ...base, modifiers: base.modifiers ^ bit });
  };

  const setBase = (raw: string) => {
    const base = raw === '' ? null : Number(raw);
    commit({ modifiers: chord?.modifiers ?? 0, base });
  };

  const error = chord ? chordError(chord) : null;
  const modifierCount = chord ? modifierIdsFromMask(chord.modifiers).length : 0;
  const warning = special
    ? `${firmwareCodeLabel(value, 'mac')} is a special key (Fn, media or another fixed code) and can't be combined with modifiers. Choose a base key below to replace it.`
    : error
      ? 'Choose a base key or at least one modifier; an empty key would do nothing. Nothing is staged until the chord is valid.'
      : modifierCount >= 4
        ? 'Chords with 4 or more modifiers are encoded, but some apps ignore them.'
        : null;

  const preview = chord && !error ? chordLabel(chord, 'mac') : special ? firmwareCodeLabel(value, 'mac') : '—';
  const previewCode = chord && !error ? encodeChord(chord) : special ? value : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-card-foreground">Compose a key or chord</h4>
        <span className="text-xs text-muted-foreground">Changes stage instantly · Apply sends them</span>
      </div>

      <div className="space-y-2">
        <span id="chord-modifiers-label" className="text-sm font-medium text-foreground">Modifiers</span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="chord-modifiers-label">
          {MODIFIERS.map(m => {
            const pressed = !!chord && (chord.modifiers & m.bit) !== 0;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={pressed}
                disabled={disabled || special}
                onClick={() => toggleModifier(m.bit)}
                className={`min-h-9 px-3 py-1.5 text-xs border rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  pressed
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border hover:bg-accent text-foreground'
                }`}
              >
                {pressed && <span aria-hidden="true">✓ </span>}
                {m.side === 'left' ? 'Left' : 'Right'} {KIND_CHIP[m.kind]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          GUI/Win bits are labeled ⌘ Command and Alt bits ⌥ Option. Left and right bits are kept separate and sent
          exactly as chosen; the app does no automatic host swap. How macOS or Windows acts on them needs testing on
          the keyboard.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="chord-base-key" className="text-sm font-medium text-foreground block">Base key</label>
          <select
            id="chord-base-key"
            value={chord?.base ?? ''}
            onChange={e => setBase(e.target.value)}
            disabled={disabled}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">{special ? '— special key —' : '(none — modifiers only)'}</option>
            {BASE_KEYS.map(k => (
              <option key={k.hid} value={k.hid}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <span className="text-sm font-medium text-foreground block">Result</span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge className="font-mono text-sm px-3 py-1">{preview}</Badge>
            {previewCode !== null && (
              <Badge variant="secondary" className="font-mono text-xs">fw={fwHex(previewCode)}</Badge>
            )}
          </span>
        </div>
      </div>

      {warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/40 px-3 py-2" role="status">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
          <p className="text-sm text-card-foreground">{warning}</p>
        </div>
      )}
    </div>
  );
}
