import { useState, useEffect, useRef } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import type { LightingMode } from '../types/keyboard';
import type { StandardLightingSettings } from '../models/LightingCodec';
import type { ImageManifest } from '../utils/buildImageManifest';
import type { DeviceDraft } from '../hooks/useDeviceDraft';
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info } from 'lucide-react';
import { ColorWheel } from './ColorWheel';
import { LightingPainter } from './LightingPainter';
import { ApplyErrorAlert } from './PendingChanges';
import { Badge } from '@/components/ui/badge';

const SPEED_LABELS = ['Very Slow', 'Slow', 'Normal', 'Fast', 'Very Fast'];
const SLEEP_LABELS = ['5 min', '10 min', '20 min', '30 min', 'Off'];

interface LightingControlsProps {
  device: KeyboardDevice;
  imageManifest?: ImageManifest;
  draft: DeviceDraft;
  /** A lighting record exists in this browser (otherwise the applied values are app defaults). */
  hasLightingRecord: boolean;
  /** Editing is locked (a transfer is running or the keyboard can't be written). */
  locked: boolean;
  /** The pane's pending/apply bar. */
  pendingBar: React.ReactNode;
}

/**
 * Global lighting and per-key color editor. Every control only stages the
 * draft; nothing is sent until the pane's Apply.
 */
export function LightingControls({ device, imageManifest, draft, hasLightingRecord, locked, pendingBar }: LightingControlsProps) {
  const settings = draft.lighting;
  const applied = device.lightingSettings;
  const selectedModeRef = useRef<HTMLButtonElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(false);

  const isDemo = !!device.isDemo;
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

  const colorHex = `#${color.r.toString(16).padStart(2, '0')}${color.g.toString(16).padStart(2, '0')}${color.b.toString(16).padStart(2, '0')}`;

  const customMode = draft.customMode;
  const customModeName =
    customMode !== null ? device.config.lightingModes.find(m => m.index === customMode)?.name ?? `Mode ${customMode}` : '';

  return (
    <div className="space-y-6">
      <ApplyErrorAlert message={draft.errors.lighting} />

      <div className="flex justify-center">
        <div className="flex flex-wrap gap-8 justify-center">
          {/* Left column - Mode selector */}
          <div className="space-y-3 w-full sm:w-[300px]">
            <div className="flex items-baseline gap-2">
              <h3 className="text-sm font-semibold text-foreground">Lighting Modes</h3>
              <span className="text-xs text-muted-foreground">
                {device.config.rgb ? `RGB · ${device.config.keys.length} keys` : 'Single-color'}
              </span>
              {isDemo && (
                <Badge variant="outline" className="text-xs text-primary border-primary">
                  DEMO
                </Badge>
              )}
            </div>
            <div className="relative border border-border rounded-lg overflow-hidden">
              {showTopShadow && (
                <div className="absolute top-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-b from-foreground/10 to-transparent" />
              )}
              {showBottomShadow && (
                <div className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-t from-foreground/10 to-transparent" />
              )}

              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="max-h-[300px] overflow-y-auto"
                role="listbox"
                aria-label="Lighting modes"
              >
                {device.config.lightingModes.map((mode: LightingMode) => {
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
                      className={`w-full px-4 py-3 text-left text-sm transition-colors border-b border-border last:border-b-0 flex items-center justify-between gap-2 disabled:cursor-not-allowed ${
                        isSelected
                          ? 'bg-primary text-primary-foreground font-medium'
                          : 'bg-background text-foreground hover:bg-accent'
                      }`}
                    >
                      <span>{mode.name}</span>
                      {status && <span className="text-xs opacity-75 font-normal">{status}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right column - Controls */}
          <div className="space-y-6 w-full sm:w-auto sm:max-w-md">
            {!isOffMode && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="sleep-timer" className="text-sm font-medium text-foreground">Sleep Timer</label>
                  <span className="text-sm text-muted-foreground">{SLEEP_LABELS[sleep - 1]}</span>
                </div>
                <Slider
                  id="sleep-timer"
                  value={[sleep]}
                  onValueChange={v => stage({ sleep: v[0] })}
                  min={1}
                  max={5}
                  step={1}
                  disabled={locked}
                  aria-label="Sleep timer"
                />
              </div>
            )}

            {flags?.speed && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="speed-slider" className="text-sm font-medium text-foreground">Speed</label>
                  <span className="text-sm text-muted-foreground">{SPEED_LABELS[speed - 1]}</span>
                </div>
                <Slider
                  id="speed-slider"
                  value={[speed]}
                  onValueChange={v => stage({ speed: v[0] })}
                  min={1}
                  max={5}
                  step={1}
                  disabled={locked}
                  aria-label="Lighting speed"
                />
              </div>
            )}

            {flags?.brightness && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label htmlFor="brightness-slider" className="text-sm font-medium text-foreground">Brightness</label>
                  <span className="text-sm text-muted-foreground">{brightness} / 5</span>
                </div>
                <Slider
                  id="brightness-slider"
                  value={[brightness]}
                  onValueChange={v => stage({ brightness: v[0] })}
                  min={0}
                  max={5}
                  step={1}
                  disabled={locked}
                  aria-label="Lighting brightness"
                />
              </div>
            )}

            {flags?.random && (
              <div className="space-y-3">
                <span id="color-mode-label" className="text-sm font-medium text-foreground block">Color</span>
                <div className="inline-flex bg-muted border border-border rounded-lg p-0.5" role="group" aria-labelledby="color-mode-label">
                  {[false, true].map(isRandom => (
                    <button
                      key={String(isRandom)}
                      onClick={() => stage({ randomColor: isRandom })}
                      disabled={locked}
                      aria-pressed={randomColor === isRandom}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
                        randomColor === isRandom
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                      }`}
                    >
                      {isRandom ? 'Random' : 'Custom'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {flags?.colorPicker && (
              <div className={`space-y-3 transition-opacity ${randomColor || locked ? 'opacity-40 pointer-events-none' : ''}`} aria-disabled={randomColor || locked}>
                <span id="color-picker-label" className="text-sm font-medium text-foreground">Color</span>
                <div className="flex flex-col items-start gap-3">
                  <ColorWheel color={color} onChange={c => stage({ color: c })} size={200} />
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="color-picker-label">
                    {[
                      { name: 'White', r: 255, g: 255, b: 255 },
                      { name: 'Red', r: 255, g: 0, b: 0 },
                      { name: 'Orange', r: 255, g: 165, b: 0 },
                      { name: 'Yellow', r: 255, g: 255, b: 0 },
                      { name: 'Green', r: 0, g: 255, b: 0 },
                      { name: 'Cyan', r: 0, g: 255, b: 255 },
                      { name: 'Blue', r: 0, g: 0, b: 255 },
                      { name: 'Magenta', r: 255, g: 0, b: 255 },
                    ].map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => stage({ color: { r: preset.r, g: preset.g, b: preset.b } })}
                        className="w-8 h-8 rounded border-2 border-border hover:border-primary transition-colors"
                        style={{ backgroundColor: `rgb(${preset.r}, ${preset.g}, ${preset.b})` }}
                        title={preset.name}
                        aria-label={`Set color to ${preset.name}`}
                      />
                    ))}
                  </div>
                  <span className="text-sm font-mono text-muted-foreground" aria-live="polite">{colorHex.toUpperCase()}</span>
                </div>
              </div>
            )}

            {!flags?.speed && !flags?.brightness && !flags?.colorPicker && !flags?.random && isOffMode && (
              <div className="text-sm text-muted-foreground italic">
                No additional controls available for this mode.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-6">
        {customMode !== null ? (
          <LightingPainter
            device={device}
            imageManifest={imageManifest}
            colors={draft.colors}
            appliedColors={draft.appliedColors}
            onChange={draft.stageColors}
            customModeName={customModeName}
            inCustomMode={draft.colorsSendable}
            onSwitchToCustom={() => stage({ modeIndex: customMode })}
            disabled={locked}
          />
        ) : (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <p className="font-semibold text-card-foreground">Per-key colors aren&apos;t available on this board</p>
              <p>
                {device.config.rgb
                  ? 'Its configuration lists RGB lighting, but no per-key custom mode has been established for this exact model, so this app sends only mode, speed, brightness, color and sleep settings.'
                  : 'Its configuration describes single-color lighting (no RGB keys), so only the mode, speed, brightness and sleep settings apply.'}
              </p>
            </AlertDescription>
          </Alert>
        )}
      </div>

      {pendingBar}
    </div>
  );
}
