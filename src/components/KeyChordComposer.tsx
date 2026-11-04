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
  ctrl: 'Ctrl',
  shift: 'Shift',
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
    <div className="space-y-3">
      <h3 className="flex flex-col gap-0.5 text-[13px] font-extrabold text-card-foreground">
        Compose a key or chord
        <small className="text-xs font-medium text-muted-foreground">Changes stage instantly · Apply sends them</small>
      </h3>

      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Modifiers">
        {MODIFIERS.map(m => {
          const pressed = !!chord && (chord.modifiers & m.bit) !== 0;
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={pressed}
              title={`${m.side === 'left' ? 'Left' : 'Right'} ${KIND_CHIP[m.kind]}`}
              disabled={disabled || special}
              onClick={() => toggleModifier(m.bit)}
              className={`h-[34px] rounded-full border text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                pressed
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border hover:bg-accent text-foreground'
              }`}
            >
              {m.side === 'left' ? 'L' : 'R'} {KIND_CHIP[m.kind]}
            </button>
          );
        })}
      </div>

      <div className="grid gap-1.5 text-[13px]">
        <label htmlFor="chord-base-key" className="text-foreground">Base key</label>
        <select
          id="chord-base-key"
          value={chord?.base ?? ''}
          onChange={e => setBase(e.target.value)}
          disabled={disabled}
          className="h-9 w-full rounded-full border border-input bg-background px-3 text-sm text-foreground disabled:opacity-50"
        >
          <option value="">{special ? '— special key —' : '(none — modifiers only)'}</option>
          {BASE_KEYS.map(k => (
            <option key={k.hid} value={k.hid}>{k.label}</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span className="text-muted-foreground">Result</span>
        <Badge className="font-mono text-sm px-3 py-1">{preview}</Badge>
        {previewCode !== null && (
          <Badge variant="secondary" className="font-mono text-xs">fw={fwHex(previewCode)}</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Left and right modifiers are sent exactly as chosen. There is no automatic Mac/Windows swap. GUI/Win bits are
        labeled ⌘ Command and Alt bits ⌥ Option; how macOS or Windows acts on them needs testing on the keyboard.
      </p>

      {warning && (
        <div className="flex items-start gap-2 rounded-[var(--radius)] border border-[color-mix(in_srgb,#f59e0b_45%,transparent)] bg-[color-mix(in_srgb,#f59e0b_9%,transparent)] px-3 py-2" role="status">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0 text-[#f59e0b]" aria-hidden="true" />
          <p className="text-sm text-card-foreground">{warning}</p>
        </div>
      )}
    </div>
  );
}
