import { useEffect, useRef, useState } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { PerKeyColors } from '../models/LightingCodec';
import type { ImageManifest } from '../utils/buildImageManifest';
import { PALETTE_PRESETS, clearKeys, fillKeys, type RgbColor } from '../utils/lightingPalettes';
import { KeyboardCanvas, type KeyActivation } from './KeyboardCanvas';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';

const QUICK_COLORS: Array<{ name: string } & RgbColor> = [
  { name: 'White', r: 255, g: 255, b: 255 },
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 165, b: 0 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
];

function toHex(c: RgbColor): string {
  return `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function fromHex(value: string): RgbColor | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function previewGradient(colors: PerKeyColors): string {
  const distinct = [...new Set(Object.values(colors).map(c => toHex(c)))].slice(0, 2);
  if (distinct.length === 0) return 'transparent';
  return distinct.length === 1 ? distinct[0] : `linear-gradient(90deg, ${distinct[0]} 50%, ${distinct[1]} 50%)`;
}

interface LightingPainterProps {
  device: KeyboardDevice;
  imageManifest?: ImageManifest;
  /** Complete draft colors per physical key. */
  colors: PerKeyColors;
  /** Last applied (or starting) colors, to mark pending keys. */
  appliedColors: PerKeyColors;
  onChange: (colors: PerKeyColors) => void;
  /** Display name of the variant's established custom mode. */
  customModeName: string;
  /** Draft mode is the custom mode. */
  inCustomMode: boolean;
  onSwitchToCustom: () => void;
  disabled: boolean;
}

type Tool = 'select' | 'brush';

/** Per-key selection and painting. Every action only stages the draft. */
export function LightingPainter({
  device,
  imageManifest,
  colors,
  appliedColors,
  onChange,
  customModeName,
  inCustomMode,
  onSwitchToCustom,
  disabled,
}: LightingPainterProps) {
  const config = device.config;
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [paint, setPaint] = useState<RgbColor>({ r: 0, g: 12, b: 255 });
  const [hexText, setHexText] = useState(toHex({ r: 0, g: 12, b: 255 }));
  const [hexError, setHexError] = useState(false);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  // End a mouse drag anywhere on the page.
  const dragging = useRef(false);
  useEffect(() => {
    const stop = () => { dragging.current = false; };
    window.addEventListener('pointerup', stop);
    return () => window.removeEventListener('pointerup', stop);
  }, []);

  const setPaintColor = (c: RgbColor) => {
    setPaint(c);
    setHexText(toHex(c));
    setHexError(false);
  };

  const paintKeys = (keys: Iterable<number>) => {
    const next = fillKeys(config, paint, colorsRef.current, keys);
    // Keep consecutive drag strokes cumulative even before the next render.
    colorsRef.current = next;
    onChange(next);
  };

  const toggle = (bIndex: number) => {
    setSelection(prev => {
      const next = new Set(prev);
      if (next.has(bIndex)) next.delete(bIndex);
      else next.add(bIndex);
      return next;
    });
  };

  const add = (bIndex: number) => setSelection(prev => (prev.has(bIndex) ? prev : new Set(prev).add(bIndex)));

  const handleMouseDown = (bIndex: number, { additive }: KeyActivation) => {
    dragging.current = true;
    if (tool === 'brush') {
      paintKeys([bIndex]);
    } else if (additive) {
      toggle(bIndex);
    } else {
      setSelection(new Set([bIndex]));
    }
  };

  const handleMouseDrag = (bIndex: number) => {
    if (!dragging.current) return;
    if (tool === 'brush') paintKeys([bIndex]);
    else add(bIndex);
  };

  // Touch/pen taps (no drag, so swipes scroll the keyboard).
  const handleTap = (bIndex: number) => {
    if (tool === 'brush') paintKeys([bIndex]);
    else toggle(bIndex);
  };

  const handleAction = (bIndex: number, action: 'space' | 'enter') => {
    if (action === 'space') toggle(bIndex);
    else paintKeys(selection.size > 0 ? selection : [bIndex]);
  };

  const allKeys = config.keys.map(k => k.bIndex);
  const count = selection.size;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">Per-key colors</h3>
          <Badge variant="secondary" className="text-xs">Used by “{customModeName}”</Badge>
        </div>
        <div className="inline-flex bg-muted border border-border rounded-lg p-0.5" role="group" aria-label="Pointer tool">
          {(['select', 'brush'] as const).map(t => (
            <button
              key={t}
              type="button"
              aria-pressed={tool === t}
              onClick={() => setTool(t)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                tool === t
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              {t === 'select' ? 'Select' : 'Brush'}
            </button>
          ))}
        </div>
      </div>

      {!inCustomMode && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <p>
              Per-key colors show only in <strong>{customModeName}</strong> mode, and they are sent only with it. You can
              still paint now; choose {customModeName} before you Apply to send them.
            </p>
            <Button variant="outline" size="sm" className="mt-1" onClick={onSwitchToCustom} disabled={disabled}>
              Switch to {customModeName}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <p className="sm:hidden text-xs text-muted-foreground">
        Tap a key to select or unselect it, then use Paint selected (with Brush, a tap paints that key).
      </p>

      <KeyboardCanvas
        device={device}
        imageManifest={imageManifest}
        ariaLabel={`${config.name} key colors — select keys, then paint`}
        keyColors={colors}
        appliedColors={appliedColors}
        selectedKeys={selection}
        disabled={disabled}
        onKeyMouseDown={handleMouseDown}
        onKeyMouseDrag={handleMouseDrag}
        onKeyClick={handleTap}
        onKeyAction={handleAction}
        onKeyExtend={add}
      />
      <p className="text-xs text-muted-foreground">
        Click selects · Shift/⌘-click adds · drag selects (or paints with Brush) · Arrows move · Shift+Arrow extends ·
        Space toggles · Enter paints
      </p>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="paint-color" className="text-sm font-medium text-foreground block">Paint color</label>
          <div className="flex items-center gap-2">
            <input
              id="paint-color"
              type="color"
              value={toHex(paint).toLowerCase()}
              onChange={e => {
                const c = fromHex(e.target.value);
                if (c) setPaintColor(c);
              }}
              className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
            />
            <Input
              value={hexText}
              onChange={e => {
                setHexText(e.target.value);
                const c = fromHex(e.target.value);
                setHexError(!c);
                if (c) setPaint(c);
              }}
              aria-label="Paint color hex"
              aria-invalid={hexError}
              className="w-28 font-mono"
            />
          </div>
          {hexError && <p className="text-xs text-destructive">Use a 6-digit hex color like #00E5FF.</p>}
        </div>
        <div className="space-y-1">
          <span id="quick-colors-label" className="text-sm font-medium text-foreground block">Quick colors</span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="quick-colors-label">
            {QUICK_COLORS.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => setPaintColor({ r: c.r, g: c.g, b: c.b })}
                className="w-8 h-8 rounded border-2 border-border hover:border-primary transition-colors"
                style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                title={c.name}
                aria-label={`Paint with ${c.name}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground mr-1" aria-live="polite">
          {count} key{count === 1 ? '' : 's'} selected
        </span>
        <Button size="sm" onClick={() => paintKeys(selection)} disabled={disabled || count === 0}>
          Paint selected
        </Button>
        <Button size="sm" variant="outline" onClick={() => onChange(fillKeys(config, paint, colors))} disabled={disabled}>
          Fill all
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onChange(clearKeys(config, colors, selection))}
          disabled={disabled || count === 0}
          title="Sets selected keys to black (LED off)"
        >
          Turn off selected
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelection(new Set(allKeys))}>
          Select all
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())} disabled={count === 0}>
          Select none
        </Button>
      </div>

      <div className="space-y-2">
        <span id="palettes-label" className="text-sm font-medium text-foreground block">
          Built-in palettes{' '}
          <span className="text-xs font-normal text-muted-foreground">
            (replace the draft colors and stage {customModeName}; colors stay editable)
          </span>
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="palettes-label">
          {PALETTE_PRESETS.map(preset => {
            const built = preset.build(config);
            return (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onChange(built);
                  if (!inCustomMode) onSwitchToCustom();
                }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-4 h-4 rounded-sm border border-border"
                  style={{ background: previewGradient(built) }}
                />
                {preset.name}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
