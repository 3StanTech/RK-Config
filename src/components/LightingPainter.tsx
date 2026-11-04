import { useEffect, useRef, useState } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { PerKeyColors } from '../models/LightingCodec';
import { PALETTE_PRESETS, QUICK_COLORS, clearKeys, fillKeys, fromHex, toHex, type RgbColor } from '../utils/lightingPalettes';
import { KeyboardCanvas, KeyboardLegend, type KeyActivation } from './KeyboardCanvas';
import { Button } from '@/components/ui/button';
import { MousePointer2, Brush, PaintBucket, Sun, X, CheckCheck, SquareDashed } from 'lucide-react';

function previewGradient(colors: PerKeyColors): string {
  const distinct = [...new Set(Object.values(colors).map(c => toHex(c)))].slice(0, 2);
  if (distinct.length === 0) return 'transparent';
  return distinct.length === 1 ? distinct[0] : `linear-gradient(90deg, ${distinct[0]} 50%, ${distinct[1]} 50%)`;
}

interface LightingPainterProps {
  device: KeyboardDevice;
  /** Complete draft colors per physical key. */
  colors: PerKeyColors;
  /** Last applied (or starting) colors, to mark pending keys. */
  appliedColors: PerKeyColors;
  onChange: (colors: PerKeyColors) => void;
  /** Draft mode is the custom mode. */
  inCustomMode: boolean;
  onSwitchToCustom: () => void;
  disabled: boolean;
}

type Tool = 'select' | 'brush';

/** Per-key selection and painting on the stage: tool palette, keyboard and colour dock. Every action only stages the draft. */
export function LightingPainter({
  device,
  colors,
  appliedColors,
  onChange,
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

  const tools: Array<{ id: Tool; label: string; Icon: typeof Brush }> = [
    { id: 'select', label: 'Select', Icon: MousePointer2 },
    { id: 'brush', label: 'Brush', Icon: Brush },
  ];

  return (
    <div className="ed-stage" data-tools="">
      <div className="tool-palette float" role="group" aria-label="Per-key tools">
        {tools.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-pressed={tool === id} onClick={() => setTool(id)}>
            <Icon aria-hidden="true" />
            {label}
          </button>
        ))}
        <hr />
        <button type="button" onClick={() => paintKeys(selection)} disabled={disabled || count === 0}>
          <PaintBucket aria-hidden="true" />
          Paint selected
        </button>
        <button type="button" onClick={() => onChange(fillKeys(config, paint, colors))} disabled={disabled}>
          <Sun aria-hidden="true" />
          Fill all
        </button>
        <button
          type="button"
          onClick={() => onChange(clearKeys(config, colors, selection))}
          disabled={disabled || count === 0}
          title="Sets selected keys to black (LED off)"
        >
          <X aria-hidden="true" />
          Turn off selected
        </button>
        <hr />
        <button type="button" onClick={() => setSelection(new Set(allKeys))}>
          <CheckCheck aria-hidden="true" />
          Select all
        </button>
        <button type="button" onClick={() => setSelection(new Set())} disabled={count === 0}>
          <SquareDashed aria-hidden="true" />
          Select none
        </button>
      </div>

      <div className="w-full max-w-[980px] min-w-0">
        <p className="mb-2 text-center text-xs text-muted-foreground">
          <span aria-live="polite" className="font-semibold text-foreground">
            {count} key{count === 1 ? '' : 's'} selected
          </span>
          <span className="max-sm:hidden">
            {' '}· Click selects · Shift/⌘-click adds · drag selects (or paints with Brush) · Arrows move · Shift+Arrow
            extends · Space toggles · Enter paints
          </span>
          <span className="sm:hidden"> · Tap a key to select or unselect it, then use Paint selected (with Brush, a tap paints that key).</span>
        </p>
        <div className="mb-2 flex justify-center"><KeyboardLegend colorView /></div>
        <KeyboardCanvas
          device={device}
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
      </div>

      <div className="color-dock float text-[12.5px]">
        <span id="quick-colors-label" className="text-card-foreground">Quick colors</span>
        <div className="flex gap-1.5" role="group" aria-labelledby="quick-colors-label">
          {QUICK_COLORS.map(c => {
            const on = paint.r === c.r && paint.g === c.g && paint.b === c.b;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => setPaintColor({ r: c.r, g: c.g, b: c.b })}
                aria-pressed={on}
                className={`size-6 rounded-full border border-[color-mix(in_srgb,var(--foreground)_20%,transparent)] ${on ? 'shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--ring)]' : ''}`}
                style={{ backgroundColor: `rgb(${c.r}, ${c.g}, ${c.b})` }}
                title={c.name}
                aria-label={`Paint with ${c.name}`}
              />
            );
          })}
        </div>
        <label className="inline-flex items-center gap-1.5">
          <span className="sr-only">Paint color</span>
          <input
            id="paint-color"
            type="color"
            value={toHex(paint).toLowerCase()}
            onChange={e => {
              const c = fromHex(e.target.value);
              if (c) setPaintColor(c);
            }}
            className="h-6 w-7 cursor-pointer rounded border border-border bg-background p-0"
          />
          <input
            value={hexText}
            onChange={e => {
              setHexText(e.target.value);
              const c = fromHex(e.target.value);
              setHexError(!c);
              if (c) setPaint(c);
            }}
            aria-label="Paint color hex"
            aria-invalid={hexError}
            aria-describedby={hexError ? 'paint-hex-error' : undefined}
            className="h-7 w-[86px] rounded-full bg-muted px-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive"
          />
        </label>
        {hexError && <span id="paint-hex-error" className="text-xs text-destructive">Use a 6-digit hex color like #00E5FF.</span>}
        <span className="h-5 w-px bg-border" aria-hidden="true" />
        <span id="palettes-label" className="sr-only">Built-in palettes</span>
        <div className="flex gap-1 max-[1100px]:flex-wrap" role="group" aria-labelledby="palettes-label">
          {PALETTE_PRESETS.map(preset => {
            const built = preset.build(config);
            return (
              <Button
                key={preset.id}
                variant="ghost"
                size="sm"
                className="rounded-full font-bold"
                disabled={disabled}
                title="Replaces the draft colors and stages the custom mode; colors stay editable"
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
