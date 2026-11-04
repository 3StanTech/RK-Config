import { useState, useEffect, useRef } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { LightingMode } from '../types/keyboard';
import type { StandardLightingSettings } from '../models/LightingCodec';
import type { DeviceDraft } from '../hooks/useDeviceDraft';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { ColorWheel } from './ColorWheel';
import { LightingPainter } from './LightingPainter';
import { KeyboardCanvas } from './KeyboardCanvas';
import { ApplyErrorAlert } from './PendingChanges';
import { QUICK_COLORS, SLEEP_LABELS, SPEED_LABELS, toHex } from '../utils/lightingPalettes';


interface LightingControlsProps {
  device: KeyboardDevice;
  draft: DeviceDraft;
  /** A lighting record exists in this browser (otherwise the applied values are app defaults). */
  hasLightingRecord: boolean;
  /** Editing is locked (a transfer is running or the keyboard can't be written). */
  locked: boolean;
  /** The pane's pending/apply bar. */
  pendingBar: React.ReactNode;
  /** Shared inspector panels after the lighting panels (RK web note, saved record). */
  inspectorFooter: React.ReactNode;
}

/**
 * Lighting view: per-key painting on the stage, global lighting in the inspector.
 * Every control only stages the draft; nothing is sent until the pane's Apply.
 */
export function LightingControls({ device, draft, hasLightingRecord, locked, pendingBar, inspectorFooter }: LightingControlsProps) {
  const settings = draft.lighting;
  const applied = device.lightingSettings;
  const selectedModeRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);

  const selectedModeIndex = settings?.modeIndex ?? null;

  // Scroll to initially selected mode after layout and update shadows (display only)
  useEffect(() => {
    selectedModeRef.current?.scrollIntoView({ block: 'nearest' });

    const container = scrollContainerRef.current;
    if (container) {
      const isScrollable = container.scrollHeight > container.clientHeight;
      setShowBottomShadow(isScrollable);
    }
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isScrollable = target.scrollHeight > target.clientHeight;
    setShowTopShadow(isScrollable && target.scrollTop > 0);
    setShowBottomShadow(isScrollable && target.scrollTop + target.clientHeight < target.scrollHeight - 1);
  };

  if (!device.config.lightEnabled || !settings) {
    return null;
  }

  const stage = (patch: Partial<StandardLightingSettings>) => {
    if (locked) return;
    draft.stageLighting({ ...settings, ...patch });
  };

  const { speed, brightness, color, randomColor, sleep } = settings;

  const currentMode = device.config.lightingModes.find(m => m.index === selectedModeIndex);
  const flags = currentMode?.flags;
  const isOffMode = currentMode?.name.toLowerCase().includes('off') || false;


  const customMode = draft.customMode;
  const customModeName =
    customMode !== null ? device.config.lightingModes.find(m => m.index === customMode)?.name ?? `Mode ${customMode}` : '';

  const config = device.config;
  const panelTitle = 'flex flex-col gap-0.5 text-[13px] font-extrabold text-card-foreground mb-2.5';
  const sliderRow = (id: string, label: string, value: string) => (
    <div className="flex items-center justify-between text-[13px]">
      <label htmlFor={id} className="font-semibold text-foreground">{label}</label>
      <span className="font-mono text-xs text-muted-foreground">{value}</span>
    </div>
  );

  return (
    <>
      {customMode !== null ? (
        <LightingPainter
          device={device}
          colors={draft.colors}
          appliedColors={draft.appliedColors}
          onChange={draft.stageColors}
          inCustomMode={draft.colorsSendable}
          onSwitchToCustom={() => stage({ modeIndex: customMode })}
          disabled={locked}
        />
      ) : (
        <div className="ed-stage">
          <KeyboardCanvas device={device} readOnly ariaLabel={`${config.name} layout`} />
        </div>
      )}

      <div className="ed-insp float" aria-label="Lighting inspector" role="region">
        <ApplyErrorAlert message={draft.errors.lighting} />

        <div>
          <h3 className={panelTitle}>
            Lighting modes
            <small className="text-xs font-medium text-muted-foreground">
              {config.rgb ? `RGB · ${config.keys.length} keys` : 'Single-color'}
            </small>
          </h3>
          <div className="relative">
            {showTopShadow && (
              <div className="absolute top-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-b from-foreground/10 to-transparent" />
            )}
            {showBottomShadow && (
              <div className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-t from-foreground/10 to-transparent" />
            )}
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="grid max-h-[260px] gap-1 overflow-y-auto"
              role="listbox"
              aria-label="Lighting modes"
            >
              {config.lightingModes.map((mode: LightingMode) => {
                const isSelected = mode.index === selectedModeIndex;
                const isApplied = mode.index === applied?.modeIndex;
                const status = isApplied
                  ? (hasLightingRecord ? 'Last sent' : 'Default · not sent')
                  : isSelected
                    ? '● pending'
                    : '';
                return (
                  <button
                    key={mode.index}
                    ref={isSelected ? selectedModeRef : null}
                    onClick={() => stage({ modeIndex: mode.index })}
                    disabled={locked}
                    role="option"
                    aria-selected={isSelected}
                    className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-full px-3.5 py-1.5 text-left text-[13.5px] font-semibold transition-colors disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <span>{mode.name}</span>
                    {status && (
                      <small className={`text-[11px] font-medium ${status === '● pending' ? 'font-extrabold' : 'opacity-75'}`}>
                        {status}
                      </small>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {!isOffMode && (
            <div className="space-y-2">
              {sliderRow('sleep-timer', 'Sleep timer', SLEEP_LABELS[sleep - 1])}
              <Slider id="sleep-timer" value={[sleep]} onValueChange={v => stage({ sleep: v[0] })} min={1} max={5} step={1} disabled={locked} aria-label="Sleep timer" />
            </div>
          )}
          {flags?.speed && (
            <div className="space-y-2">
              {sliderRow('speed-slider', 'Speed', SPEED_LABELS[speed - 1])}
              <Slider id="speed-slider" value={[speed]} onValueChange={v => stage({ speed: v[0] })} min={1} max={5} step={1} disabled={locked} aria-label="Lighting speed" />
            </div>
          )}
          {flags?.brightness && (
            <div className="space-y-2">
              {sliderRow('brightness-slider', 'Brightness', `${brightness} / 5`)}
              <Slider id="brightness-slider" value={[brightness]} onValueChange={v => stage({ brightness: v[0] })} min={0} max={5} step={1} disabled={locked} aria-label="Lighting brightness" />
            </div>
          )}
          {!flags?.speed && !flags?.brightness && !flags?.colorPicker && !flags?.random && isOffMode && (
            <p className="text-sm text-muted-foreground italic">No additional controls available for this mode.</p>
          )}
        </div>

        {(flags?.random || flags?.colorPicker) && (
          <div className="space-y-3">
            <h3 id="color-mode-label" className={panelTitle}>Color</h3>
            {flags?.random && (
              <div className="inline-flex gap-0.5 rounded-full bg-muted p-[3px]" role="group" aria-labelledby="color-mode-label">
                {[false, true].map(isRandom => (
                  <button
                    key={String(isRandom)}
                    onClick={() => stage({ randomColor: isRandom })}
                    disabled={locked}
                    aria-pressed={randomColor === isRandom}
                    className={`h-[30px] rounded-full px-3.5 text-[12.5px] font-bold transition-all ${
                      randomColor === isRandom
                        ? 'bg-card text-card-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {isRandom ? 'Random' : 'Custom'}
                  </button>
                ))}
              </div>
            )}
            {flags?.colorPicker && (
              <div className={`space-y-3 transition-opacity ${randomColor || locked ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={randomColor || locked}>
                <ColorWheel color={color} onChange={c => stage({ color: c })} size={160} />
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Color">
                  {QUICK_COLORS.map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => stage({ color: { r: preset.r, g: preset.g, b: preset.b } })}
                      className="size-6 rounded-full border border-[color-mix(in_srgb,var(--foreground)_20%,transparent)]"
                      style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }}
                      title={preset.name}
                      aria-label={`Set color to ${preset.name}`}
                    />
                  ))}
                </div>
                <span className="inline-block rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-foreground" aria-live="polite">{toHex(color)}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 text-xs text-muted-foreground">
          {customMode !== null ? (
            <>
              <p><b className="text-card-foreground">Per-key colors</b> · Used by “{customModeName}” · Use a 6-digit hex color like #00E5FF.</p>
              {!draft.colorsSendable && (
                <>
                  <p>
                    Per-key colors show only in <strong>{customModeName}</strong> mode, and they are sent only with it. You can
                    still paint now; choose {customModeName} before you Apply to send them.
                  </p>
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => stage({ modeIndex: customMode })} disabled={locked}>
                    Switch to {customModeName}
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <p className="font-semibold text-card-foreground">Per-key colors aren&apos;t available on this board</p>
              <p>
                {config.rgb
                  ? 'Its configuration lists RGB lighting, but no per-key custom mode has been established for this exact model, so this app sends only mode, speed, brightness, color and sleep settings.'
                  : 'Its configuration describes single-color lighting (no RGB keys), so only the mode, speed, brightness and sleep settings apply.'}
              </p>
            </>
          )}
        </div>

        {inspectorFooter}
      </div>

      {pendingBar}
    </>
  );
}
