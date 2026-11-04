import { useState } from 'react';
import { useToast } from '../hooks/useToast';
import { type FirmwareCode } from '../types/keycode';
import { getLocaleLabel, getLocalizedKeyName } from '../utils/localeLabels';
import { KeyboardCanvas, KeyboardLegend } from './KeyboardCanvas';
import { KeyChordComposer } from './KeyChordComposer';
import { ApplyErrorAlert } from './PendingChanges';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import { decodeChord, firmwareCodeLabel } from '../utils/keyChords';
import {
  getKeyboardLayout,
  NAVIGATION_CLUSTER,
  NUMPAD_CLUSTER,
  ADDITIONAL_KEYS_LAYOUT,
  type KeyLayoutItem,
  type KeyboardRow,
} from '../utils/keyboardLayout';
import {
  Volume2,
  Volume1,
  VolumeX,
  SkipBack,
  Play,
  SkipForward,
  Square,
  SunMedium,
  SunDim,
  TriangleAlert,
} from 'lucide-react';

// Helper to get friendly key name (locale-aware)
function getKeyName(fwCode: FirmwareCode | undefined, locale?: string): string {
  if (fwCode === undefined) return 'Unknown';
  // Chords with modifiers get their full label; single keys keep locale labels.
  if (decodeChord(fwCode)?.modifiers) return firmwareCodeLabel(fwCode, 'mac');
  return getLocalizedKeyName(fwCode, locale);
}

function fwHex(code: FirmwareCode): string {
  return `0x${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

// Map of icon names to components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string; size?: number }>> = {
  Volume2,
  Volume1,
  VolumeX,
  SkipBack,
  Play,
  SkipForward,
  Square,
  SunMedium,
  SunDim,
};

// Helper to render a Lucide icon
function renderIcon(iconName: string, className?: string) {
  const Icon = ICON_MAP[iconName];
  if (!Icon) return null;
  return <Icon className={className} size={16} />;
}

interface KeyRemapperActionButtonProps {
  /** Number of keys the draft currently overrides. */
  draftOverrideCount: number;
  onStageResetAll: () => void;
  disabled: boolean;
}

/** Stages the factory layout for every key; nothing is sent until Apply. */
export function KeyRemapperActionButton({ draftOverrideCount, onStageResetAll, disabled }: KeyRemapperActionButtonProps) {
  const toast = useToast();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const handleConfirmReset = () => {
    setShowConfirmDialog(false);
    onStageResetAll();
    toast.showInfo('Factory layout staged for all keys. Nothing is sent until you press Apply to keyboard.');
  };

  return (
    <>
      <Button
        onClick={() => setShowConfirmDialog(true)}
        disabled={disabled || draftOverrideCount === 0}
        variant="outline"
        size="sm"
        className="ed-reset rounded-full bg-card"
        title="Stages RK's factory key assignments (not the keyboard's own reset); nothing is sent until Apply"
      >
        Reset all keys to default
      </Button>

      {showConfirmDialog && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="reset-all-title">
          <Card className="max-w-md w-full">
            <CardContent className="pt-6">
              <h3 id="reset-all-title" className="text-lg font-semibold mb-2">Stage factory layout for all keys?</h3>
              <p className="text-sm text-muted-foreground mb-6">
                This stages RK&apos;s factory key assignments for all {draftOverrideCount} remapped key{draftOverrideCount === 1 ? '' : 's'}.
                Nothing is sent until you press Apply to keyboard, and Discard undoes it before then. This is not the
                keyboard&apos;s own reset.
              </p>
              <div className="flex justify-end gap-3">
                <Button
                  onClick={() => setShowConfirmDialog(false)}
                  variant="outline"
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmReset}
                  variant="destructive"
                  size="sm"
                >
                  Stage Reset All
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

interface KeyRemapperProps {
  device: KeyboardDevice;
  /** Draft keymap (bIndex → override); absent keys use factory codes. */
  draftMappings: Map<number, FirmwareCode>;
  /** Stage an override, or undefined to stage the factory code. */
  onStage: (bIndex: number, code: FirmwareCode | undefined) => void;
  /** Editing is locked (a transfer is running or the keyboard can't be written). */
  locked: boolean;
  /** Pane-level apply error, if any. */
  error: string | null;
  /** The pane's pending/apply bar. */
  pendingBar: React.ReactNode;
  /** Stage tool under the keyboard (Reset all keys to default). */
  resetButton: React.ReactNode;
  /** Shared inspector panels after the key panels (RK web note, saved record). */
  inspectorFooter: React.ReactNode;
}

/** Key Mapping view: keyboard on the stage, selected key and targets in the inspector. */
export function KeyRemapper({ device, draftMappings, onStage, locked, error, pendingBar, resetButton, inspectorFooter }: KeyRemapperProps) {
  const [selectedKeyIndex, setSelectedKeyIndex] = useState<number | null>(null);

  const handleClearSelection = () => {
    setSelectedKeyIndex(null);
  };

  const handleKeyClick = (keyIndex: number) => {
    setSelectedKeyIndex(keyIndex);
  };

  const defaultKeyInfo = selectedKeyIndex !== null
    ? device.config.keys.find(k => k.bIndex === selectedKeyIndex)?.keyInfo
    : undefined;
  const draftOverride = selectedKeyIndex !== null ? draftMappings.get(selectedKeyIndex) : undefined;
  const appliedOverride = selectedKeyIndex !== null ? device.getMapping(selectedKeyIndex) : undefined;
  const isPending = selectedKeyIndex !== null && draftOverride !== appliedOverride;
  /** Effective draft code for the selected key (override, else factory). */
  const effectiveCode = draftOverride ?? defaultKeyInfo?.fw;
  // Highlight the matching target in the picker grids.
  const currentMapping = effectiveCode;
  const locale = device.config.locale;
  const defaultKeyLabel = defaultKeyInfo
    ? (getLocaleLabel(defaultKeyInfo.vk, locale) || defaultKeyInfo.label)
    : undefined;

  const stageTarget = (fw: FirmwareCode) => {
    if (selectedKeyIndex === null || locked) return;
    onStage(selectedKeyIndex, fw);
  };

  const handleSetToDefault = () => {
    if (selectedKeyIndex === null) return;
    onStage(selectedKeyIndex, undefined);
  };

  const targetsDisabled = selectedKeyIndex === null || locked;

  // Render a keyboard row
  const renderKeyboardRow = (row: KeyboardRow, rowIndex: number | string, allowWrap: boolean = false) => {
    return (
      <div key={rowIndex} className={`flex gap-1 ${allowWrap ? 'flex-wrap' : ''} ${row.rowClass || ''}`}>
        {row.keys.map((item, keyIndex) => {
          if (item.isPlaceholder) {
            // Render a spacer
            return (
              <div
                key={`spacer-${keyIndex}`}
                style={{ width: `${(item.width || 1) * 2.5}rem` }}
              />
            );
          }

          if (!item.keyInfo) return null;

          const keyInfo = item.keyInfo;
          const isSelected = draftOverride !== undefined && currentMapping === keyInfo.fw;
          const isCurrent = currentMapping === keyInfo.fw;
          const displayLabel = item.displayLabel || getLocaleLabel(keyInfo.vk, locale) || keyInfo.label;

          // Width: 0 means auto-width (fit content), otherwise use minimum width
          // Height: Match numpad grid height
          const style: React.CSSProperties = {};

          if (item.width === 0) {
            // Auto-width: no width constraint
          } else {
            // Use minWidth instead of width to allow horizontal expansion
            style.minWidth = `${(item.width || 1) * 2.5}rem`;
          }

          // Set fixed height to match numpad grid rows
          if (item.rowSpan && item.rowSpan > 1) {
            // Height = (rowSpan * 2rem) + ((rowSpan - 1) * 0.25rem gap)
            style.height = `calc(${item.rowSpan} * 2rem + ${item.rowSpan - 1} * 0.25rem)`;
          } else {
            // Standard key height matches numpad grid row height
            style.height = '2rem';
          }

          return (
            <button
              key={keyInfo.vk}
              onClick={() => stageTarget(keyInfo.fw)}
              disabled={targetsDisabled}
              aria-pressed={isCurrent}
              className={`px-2 py-1 text-xs border rounded transition-colors cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed shrink-0 whitespace-nowrap ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : isCurrent
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-background border-border hover:bg-accent text-foreground'
              }`}
              style={style}
              title={getLocaleLabel(keyInfo.vk, locale) || keyInfo.label}
            >
              {item.iconName && renderIcon(item.iconName)}
              <span>{displayLabel}</span>
            </button>
          );
        })}
      </div>
    );
  };

  // Render numpad with CSS Grid to support rowspan
  const renderNumpadGrid = () => {
    // Manually define grid positions for numpad keys
    // Grid is 4 columns x 5 rows
    const gridKeys: Array<{
      item: KeyLayoutItem;
      row: number;
      col: number;
      colSpan: number;
      rowSpan: number;
    }> = [];

    // Row 1: Lock, /, *, -
    NUMPAD_CLUSTER[0].keys.forEach((item, idx) => {
      gridKeys.push({ item, row: 0, col: idx, colSpan: 1, rowSpan: 1 });
    });

    // Row 2: 7, 8, 9, + (+ spans 2 rows)
    NUMPAD_CLUSTER[1].keys.forEach((item, idx) => {
      gridKeys.push({
        item,
        row: 1,
        col: idx,
        colSpan: 1,
        rowSpan: item.rowSpan || 1,
      });
    });

    // Row 3: 4, 5, 6 (column 3 is occupied by +)
    NUMPAD_CLUSTER[2].keys.forEach((item, idx) => {
      gridKeys.push({ item, row: 2, col: idx, colSpan: 1, rowSpan: 1 });
    });

    // Row 4: 1, 2, 3, Enter (Enter spans 2 rows)
    NUMPAD_CLUSTER[3].keys.forEach((item, idx) => {
      gridKeys.push({
        item,
        row: 3,
        col: idx,
        colSpan: 1,
        rowSpan: item.rowSpan || 1,
      });
    });

    // Row 5: 0 (spans 2 cols), . (column 3 is occupied by Enter)
    // 0 is double width (spans columns 0-1), . is in column 2
    gridKeys.push({ item: NUMPAD_CLUSTER[4].keys[0], row: 4, col: 0, colSpan: 2, rowSpan: 1 });
    gridKeys.push({ item: NUMPAD_CLUSTER[4].keys[1], row: 4, col: 2, colSpan: 1, rowSpan: 1 });

    return (
      <div
        className="grid gap-1"
        style={{
          gridTemplateColumns: 'repeat(4, 3.125rem)', // 4 columns, each 1.25 * 2.5rem
          gridTemplateRows: 'repeat(5, 2rem)', // 5 rows, reduced height to match nav keys
        }}
      >
        {gridKeys.map(({ item, row, col, colSpan, rowSpan }) => {
          if (!item.keyInfo) return null;

          const keyInfo = item.keyInfo;
          const isSelected = draftOverride !== undefined && currentMapping === keyInfo.fw;
          const isCurrent = currentMapping === keyInfo.fw;
          const displayLabel = item.displayLabel || getLocaleLabel(keyInfo.vk, locale) || keyInfo.label;

          return (
            <button
              key={keyInfo.vk}
              onClick={() => stageTarget(keyInfo.fw)}
              disabled={targetsDisabled}
              aria-pressed={isCurrent}
              className={`px-2 py-1 text-xs border rounded transition-colors cursor-pointer flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected
                  ? 'bg-primary text-primary-foreground border-primary'
                  : isCurrent
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'bg-background border-border hover:bg-accent text-foreground'
              }`}
              style={{
                gridColumn: `${col + 1} / span ${colSpan}`,
                gridRow: `${row + 1} / span ${rowSpan}`,
              }}
              title={getLocaleLabel(keyInfo.vk, locale) || keyInfo.label}
            >
              {item.iconName && renderIcon(item.iconName)}
              <span>{displayLabel}</span>
            </button>
          );
        })}
      </div>
    );
  };

  const pill = 'inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold';

  return (
    <>
      <div className="ed-stage">
        <KeyboardCanvas
          device={device}
          onKeyClick={handleKeyClick}
          selectedKeyIndex={selectedKeyIndex ?? undefined}
          draftMappings={draftMappings}
          ariaLabel={`${device.config.name} keys — choose a key to remap`}
        />
        <div className="ed-legend"><KeyboardLegend /></div>
        {resetButton}
      </div>

      <div className="ed-insp float" aria-label="Key inspector" role="region">
        <ApplyErrorAlert message={error} />
        <div>
          <p className="text-xs text-muted-foreground">Selected key</p>
          {selectedKeyIndex !== null ? (
            <>
              <p className="mt-1 mb-2 text-[22px] font-extrabold tracking-[-0.02em] text-card-foreground">
                {defaultKeyLabel || 'Unknown'}
                {draftOverride !== undefined && <> → {getKeyName(draftOverride, locale)}</>}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {isPending ? (
                  <span className={`${pill} bg-[color-mix(in_srgb,#f59e0b_12%,var(--background))] text-foreground`}>pending · not sent</span>
                ) : appliedOverride !== undefined ? (
                  <span className={`${pill} border border-border text-card-foreground`}>last sent</span>
                ) : null}
                <span className="font-mono text-[11px] text-muted-foreground">
                  key {selectedKeyIndex} · code {defaultKeyInfo?.vk.toString(16).toUpperCase() || '?'}
                  {defaultKeyInfo && <> · fw={fwHex(defaultKeyInfo.fw)}</>}
                  {draftOverride !== undefined && <> → fw={fwHex(draftOverride)}</>}
                </span>
              </div>
            </>
          ) : (
            <>
              <p className="mt-1 mb-2 text-[22px] font-extrabold tracking-[-0.02em] text-muted-foreground">None</p>
              <p className="text-xs text-muted-foreground">No key selected — click or Tab to a key, then press Enter</p>
            </>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              onClick={handleSetToDefault}
              disabled={selectedKeyIndex === null || draftOverride === undefined || locked}
              variant="outline"
              size="sm"
              className="rounded-full"
              title="Stages the factory key; nothing is sent until Apply"
            >
              Set to default
            </Button>
            <Button
              onClick={handleClearSelection}
              disabled={selectedKeyIndex === null}
              variant="ghost"
              size="sm"
              className="rounded-full"
            >
              Clear selection
            </Button>
          </div>
        </div>

        {selectedKeyIndex !== null && effectiveCode !== undefined && (
          <KeyChordComposer
            key={selectedKeyIndex}
            value={effectiveCode}
            onChange={stageTarget}
            disabled={locked}
          />
        )}

        <details>
          <summary className="cursor-pointer text-[13px] font-semibold text-card-foreground">
            More targets: standard layout, navigation, numpad, media and special keys
          </summary>
          <p className="text-xs text-muted-foreground mt-2">
            Picking a target stages it for the selected key and replaces any chord. Nothing is sent until Apply.
          </p>
          <div className="space-y-4 mt-4">
            <div>
              <h4 className="text-sm font-semibold mb-3 text-card-foreground">Standard Layout</h4>
              <div className="overflow-x-auto">
                <div className="space-y-1 w-fit">
                  {getKeyboardLayout(!!locale).map((row, idx) => renderKeyboardRow(row, idx))}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-card-foreground">Navigation, Arrows & Numpad</h4>
              <div className="overflow-x-auto">
                <div className="flex flex-wrap gap-4 w-fit">
                  <div className="space-y-1">
                    {NAVIGATION_CLUSTER.map((row, idx) => renderKeyboardRow(row, `nav-${idx}`))}
                  </div>
                  <div>
                    {renderNumpadGrid()}
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold mb-3 text-card-foreground">Media & Special Functions</h4>
              <div className="space-y-1">
                {ADDITIONAL_KEYS_LAYOUT.map((row, idx) => renderKeyboardRow(row, `special-${idx}`, true))}
              </div>
            </div>
          </div>
        </details>

        <KeymapWriteWarning device={device} />

        {inspectorFooter}
      </div>

      {pendingBar}
    </>
  );
}

/**
 * H2 whole-keymap warning in the Key inspector. Observations are shown only
 * for the exact model where they were recorded; other boards get the untested variant.
 */
function KeymapWriteWarning({ device }: { device: KeyboardDevice }) {
  const observed = device.config.pid.toLowerCase() === '0055';
  return (
    <div
      className="flex items-start gap-2.5 rounded-[var(--radius)] border border-[color-mix(in_srgb,#f59e0b_45%,transparent)] bg-[color-mix(in_srgb,#f59e0b_9%,transparent)] p-3.5"
      role="note"
    >
      <TriangleAlert className="h-[17px] w-[17px] mt-0.5 shrink-0 text-[#f59e0b]" aria-hidden="true" />
      <div className="space-y-2 text-[12.5px] text-muted-foreground">
        <p className="text-[13.5px] font-bold text-card-foreground">
          {observed
            ? 'Apply writes the whole keymap; on this RK61 it turns off the keyboard’s own Mac switching'
            : 'Apply writes the whole keymap'}
        </p>
        <p>
          Every key you haven&apos;t remapped gets the factory code shown in this app (Windows arrangement). On a Mac that
          means <strong>Win = Command and Alt = Option</strong> unless you remap those keys.
          {observed
            ? ''
            : ' This model hasn’t been tested with this app; a whole-keymap write may change how its own Mac/Windows switch behaves.'}
        </p>
        {observed && (
          <details>
            <summary className="cursor-pointer text-sm font-medium">What was observed on this model</summary>
            <ul className="mt-1 list-disc pl-5 space-y-1">
              <li>
                RK61 (0055), 1 Nov 2026: after one keymap Apply, the keyboard&apos;s own Fn+S Mac switch stopped working.
                Unplugging, power cycling and sending the factory layout from this app didn&apos;t bring it back.
              </li>
              <li>Native Mac behavior came back only after the keyboard&apos;s own reset (hold Fn+Space 3–5 s, then Fn+S).</li>
              <li>
                RK&apos;s guide says that reset may clear the keyboard&apos;s onboard remaps, lighting and pairings. Don&apos;t
                rely on it to keep your remaps. Lighting can be re-sent from this app afterwards.
              </li>
              <li>
                The firmware&apos;s internal behavior isn&apos;t known; this app can&apos;t read the keyboard and uses no
                hidden commands. Other RK models may behave differently.
              </li>
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
