import { useState, useRef, useEffect, useMemo } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import { KeyRemapper, KeyRemapperActionButton } from './KeyRemapper';
import { LightingControls } from './LightingControls';
import { KeyboardSelector } from './KeyboardSelector';
import { PendingChanges, type ConfirmOption, type ResendOption } from './PendingChanges';
import { useToast } from '../hooks/useToast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TriangleAlert, ExternalLink, ChevronDown } from 'lucide-react';
import type { ImageManifest } from '../utils/buildImageManifest';
import { useDevices } from '../hooks/useDevices';
import { useDeviceDraft, type DeviceDraft } from '../hooks/useDeviceDraft';
import { getRKDevices } from '../utils/rkConfig';
import { loadFullProfile, type StoredProfile } from '../utils/profileStorage';
import { firmwareCodeLabel } from '../utils/keyChords';
import { isRKWebSoftwareSupported, RK_WEB_SOFTWARE_URL } from '../constants/rkWebSoftware';
import type { ClassicCapabilities, DeviceFeature } from '../constants/deviceCapabilities';
import { getFeatureEvidence, type EvidenceRecord } from '../constants/deviceEvidence';

type Tab = 'keys' | 'lighting';

const SPEED_LABELS = ['Very Slow', 'Slow', 'Normal', 'Fast', 'Very Fast'];
const SLEEP_LABELS = ['5 min', '10 min', '20 min', '30 min', 'Off'];

interface DeviceEditorProps {
  device: KeyboardDevice;
  imageManifest?: ImageManifest;
  onDisconnect: (device: KeyboardDevice) => Promise<void>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function hex(c: { r: number; g: number; b: number }): string {
  return `#${[c.r, c.g, c.b].map(v => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Evidence text for one feature, from the evidence records; never claims more than recorded. */
function evidenceText(record: EvidenceRecord | null, fallback: string): { text: string; verified: boolean } {
  if (record?.level === 'verified-fork') {
    return { text: `Verified with this app on ${record.transport.toUpperCase()} (${record.recordedOn})`, verified: true };
  }
  if (record?.level === 'community-reported') {
    return { text: `Community-reported (${record.recordedOn}); not reproduced with this app`, verified: false };
  }
  return { text: `Experimental — ${fallback}`, verified: false };
}

interface EvidenceRow {
  label: string;
  text: string;
  available: boolean;
  verified: boolean;
}

function evidenceRows(device: KeyboardDevice, caps: ClassicCapabilities): EvidenceRow[] {
  const { config } = device;
  const pid = config.pid;
  const row = (feature: DeviceFeature, label: string, available: boolean, fallback: string, missing: string): EvidenceRow => {
    if (!available) return { label, text: missing, available, verified: false };
    const e = evidenceText(getFeatureEvidence(pid, feature), fallback);
    return { label, text: e.text, available, verified: e.verified };
  };
  const customName = caps.customLightingMode !== null
    ? config.lightingModes.find(m => m.index === caps.customLightingMode)?.name ?? `mode ${caps.customLightingMode}`
    : '';
  return [
    row('keymap', 'Key remapping', caps.keymap, `RK config file, ${config.keys.length} keys`, 'Not available — no key layout'),
    row('globalLighting', 'Global lighting', caps.globalLighting,
      config.rgb ? 'RK config file' : 'RK config file, single-color', 'Not available — no lighting in config'),
    row('perKeyColor', 'Per-key RGB', caps.perKeyColor,
      `config lists ${config.keys.length} RGB keys; ${customName} is mode ${caps.customLightingMode}`,
      config.rgb ? 'Not available — no per-key custom mode established for this model' : 'Not available — single-color board'),
  ];
}

function EvidenceAndStatus({ device, draft, hasRecord }: { device: KeyboardDevice; draft: DeviceDraft; hasRecord: boolean }) {
  const [open, setOpen] = useState(false);
  const isDemo = !!device.isDemo;
  const rows = evidenceRows(device, draft.capabilities);
  const available = rows.filter(r => r.available);
  const verifiedCount = available.filter(r => r.verified).length;

  const badgeText = isDemo
    ? 'Simulated · nothing is written'
    : verifiedCount === 0
      ? 'Experimental · from RK config files'
      : verifiedCount === available.length
        ? 'Verified on hardware'
        : `Verified on hardware · ${plural(verifiedCount, 'feature')}`;
  const badgeTone = isDemo
    ? 'border-border text-muted-foreground'
    : verifiedCount > 0
      ? 'border-green-500/50 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300'
      : 'border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200';

  const { sentThisSession, notSaved, recovery } = draft;
  const sentAreas = [sentThisSession.keymap && 'Keymap', sentThisSession.lighting && 'Lighting'].filter(Boolean);
  const anyNotSaved = notSaved.keymap || notSaved.lighting;
  const [dot, writeText] = draft.applying
    ? ['bg-primary', 'Applying…']
    : recovery.keymap || recovery.lighting
      ? ['bg-destructive', `Keyboard state uncertain — last ${recovery.keymap && recovery.lighting ? 'keymap and lighting transfers' : recovery.keymap ? 'keymap transfer' : 'lighting transfer'} failed`]
      : isDemo
        ? ['bg-muted-foreground', 'Simulated keyboard']
        : sentAreas.length > 0
          ? [anyNotSaved ? 'bg-amber-500' : 'bg-green-500',
             `${sentAreas.join(' and ')} sent this session${anyNotSaved ? ' · not saved in this browser' : ''} · keyboard not read back`]
          : hasRecord
            ? ['bg-green-500', 'Browser record of an earlier successful Apply · keyboard not read back']
            : ['bg-muted-foreground', 'Nothing sent from this browser yet · keyboard state unknown'];

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls="evidence-panel"
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium ${badgeTone}`}
        >
          {badgeText}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-foreground" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />
          {writeText}
        </span>
      </div>
      {open && (
        <div id="evidence-panel" className="mt-4 pt-4 border-t border-border">
          <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(r => (
              <div key={r.label} className="contents">
                <dt className="font-medium text-card-foreground">{r.label}</dt>
                <dd className="text-muted-foreground">{r.verified ? '✔ ' : ''}{r.text}</dd>
              </div>
            ))}
            <dt className="font-medium text-card-foreground">Connection</dt>
            <dd className="text-muted-foreground">USB only · feature report 0x0A, 64-byte payload</dd>
          </dl>
          <p className="text-xs text-muted-foreground mt-3">
            “Experimental” means the RK configuration files describe this feature; it has not been confirmed on a real{' '}
            {device.config.name} with this app yet.{isDemo ? ' Demo applies are simulations and never count as hardware verification.' : ''}
          </p>
        </div>
      )}
    </>
  );
}

function SavedInBrowserCard({ device, draft, record }: { device: KeyboardDevice; draft: DeviceDraft; record: StoredProfile | null }) {
  const isDemo = !!device.isDemo;

  let rows: Array<[string, React.ReactNode]>;
  if (isDemo) {
    rows = [['Status', 'Demo — nothing is saved and nothing is written to hardware']];
  } else {
    const { notSaved, sentThisSession } = draft;
    const DEFAULTS = 'Not saved yet; controls use app defaults';
    /**
     * Per-area text: the saved value (or the defaults note when none is saved),
     * plus a session note when this area was sent but could not be saved.
     */
    const areaText = (saved: string | null, area: 'keymap' | 'lighting'): string => {
      if (notSaved[area]) {
        return saved
          ? `Sent this session but not saved (storage full or blocked). Older saved record: ${saved}`
          : 'Sent this session but not saved (storage full or blocked); nothing is saved for this area';
      }
      return saved ?? DEFAULTS;
    };

    const label = (b: number) => device.config.keys.find(k => k.bIndex === b)?.keyInfo.label ?? `key ${b}`;
    const maps = record?.mappings ?? null;
    // An explicitly saved empty map means the factory layout was applied; null means nothing saved.
    const mapsText = maps === null
      ? null
      : maps.size === 0
        ? 'Factory layout'
        : `${plural(maps.size, 'key')} remapped (${[...maps].map(([b, c]) => `${label(b)}→${firmwareCodeLabel(c, 'mac')}`).join(', ')})`;
    const l = record?.lightingSettings ?? null;
    const modeName = l ? device.config.lightingModes.find(m => m.index === l.modeIndex)?.name ?? `Mode ${l.modeIndex}` : null;
    const lightText = l
      ? `${modeName} · ${SPEED_LABELS[l.speed - 1]} · brightness ${l.brightness} · sleep ${SLEEP_LABELS[l.sleep - 1]} · ${l.randomColor ? 'random color' : hex(l.color)}`
      : null;
    const pk = record?.perKeyColors ?? null;
    const pkText = pk
      ? `${plural(new Set(Object.values(pk).map(hex)).size, 'distinct color')} across ${plural(Object.keys(pk).length, 'key')}`
      : null;

    const nothingSaved = !mapsText && !lightText && !pkText;
    const nothingSent = !sentThisSession.keymap && !sentThisSession.lighting;
    rows = [];
    if (nothingSaved && nothingSent) {
      rows.push(['Status', 'No saved record for this keyboard. Controls use app defaults — not the keyboard’s current state, which is unknown until you Apply']);
    }
    rows.push(['Key mappings', areaText(mapsText, 'keymap')]);
    if (device.config.lightEnabled) rows.push(['Lighting', areaText(lightText, 'lighting')]);
    if (draft.capabilities.perKeyColor) {
      // A standard-mode lighting Apply sends no colors, so don't claim colors were sent.
      rows.push(['Per-key colors', notSaved.lighting
        ? `${pkText ? `Saved record: ${pkText}. ` : 'Nothing saved for this area. '}The last lighting Apply was not saved (storage full or blocked)`
        : pkText ?? DEFAULTS]);
    }
  }
  const notSaved = draft.notSaved.keymap || draft.notSaved.lighting;

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold text-card-foreground">Saved in this browser</h3>
          <span className="text-xs text-muted-foreground">localStorage · one record per keyboard · no profiles</span>
        </div>
        {notSaved && (
          <p className="text-sm text-destructive">
            The last {draft.notSaved.keymap && draft.notSaved.lighting ? 'keymap and lighting applies were' : draft.notSaved.keymap ? 'keymap apply was' : 'lighting apply was'}{' '}
            sent but not saved — browser storage is full or blocked. The saved record below doesn&apos;t include it, and a
            reload will start from that older record or from app defaults.
          </p>
        )}
        <dl className="grid grid-cols-1 sm:grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="font-medium text-card-foreground">{k}</dt>
              <dd className="text-muted-foreground break-words">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">
          The keyboard can&apos;t be read back. This record is what this browser last sent successfully; the keyboard can
          differ if it was changed elsewhere (Fn shortcuts, another computer, RK&apos;s software). Opening this page or
          reconnecting sends nothing.
        </p>
      </CardContent>
    </Card>
  );
}

export function DeviceEditor({ device, imageManifest, onDisconnect }: DeviceEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('keys');
  const lightingTabVisitedRef = useRef(false);
  const [showKeyboardSwitcher, setShowKeyboardSwitcher] = useState(false);
  const [keyboards, setKeyboards] = useState<Array<{ pid: string; name: string }>>([]);
  const { switchDemoKeyboard } = useDevices();
  const toast = useToast();
  const draft = useDeviceDraft(device);

  const isDemo = !!device.isDemo;
  const hasLighting = device.config.lightEnabled && !!draft.lighting;

  // Read-only view of what this browser has saved (never written here); re-read after each apply.
  const { savedVersion } = draft;
  const record = useMemo(() => {
    void savedVersion; // bumped by each successful apply, so the record is re-read then
    return isDemo ? null : loadFullProfile(device.id, device.config);
  }, [device, isDemo, savedVersion]);
  const hasRecord = !!record && (!!record.mappings || !!record.lightingSettings || !!record.perKeyColors);
  // Mode-list label: "Last sent" once lighting was saved or sent this session, else "Default · not sent".
  const hasLightingRecord = !!record?.lightingSettings || draft.sentThisSession.lighting;

  // Load keyboards for switcher
  useEffect(() => {
    if (isDemo) {
      getRKDevices().then(devices => {
        const kbList = Array.from(devices.entries()).map(([pid, name]) => ({ pid, name }));
        setKeyboards(kbList);
      });
    }
  }, [isDemo]);

  // Track when lighting tab is visited for the first time
  if (activeTab === 'lighting') {
    lightingTabVisitedRef.current = true;
  }

  const handleSwitchKeyboard = async (pid: string) => {
    await switchDemoKeyboard(pid);
    setShowKeyboardSwitcher(false);
  };

  const locked = draft.applying !== null || !device.connected;
  const disconnectedReason = device.connected ? null : 'The keyboard is disconnected. Reconnect it to apply; nothing was sent.';

  // H2: every whole-keymap transmission (Apply, Retry, staged Reset All) is confirmed first.
  const keymapFailed = !!draft.errors.keymap || draft.recovery.keymap;
  const stagedFactoryLayout = draft.mappings.size === 0 && device.mappings.size > 0;
  const isObservedModel = device.config.pid.toLowerCase() === '0055';
  const keymapConfirm: ConfirmOption = {
    title: keymapFailed
      ? 'Resend the whole keymap?'
      : stagedFactoryLayout
        ? 'Send the factory layout as the whole keymap?'
        : 'Send the whole keymap?',
    confirmLabel: isDemo ? '[DEMO] Simulate keymap send' : 'Send keymap (9 reports)',
    body: (
      <>
        {stagedFactoryLayout && !keymapFailed ? (
          <p>
            This sends the factory key assignments shown in this app. It is <strong>not</strong> the keyboard&apos;s own
            reset
            {isObservedModel
              ? <> and won&apos;t bring back its Fn+S Mac switching.</>
              : <>. Whether it affects or restores this model&apos;s own Mac/Windows switching hasn&apos;t been tested with this app.</>}
          </p>
        ) : keymapFailed ? (
          <p>This resends the keymap shown here after a failed transfer.</p>
        ) : (
          <p>This sends your {plural(draft.keymapPending, 'key change')} as part of the whole keymap.</p>
        )}
        <ul className="list-disc pl-5 space-y-1">
          <li>
            {isDemo
              ? 'Demo keyboard: this is simulated. Nothing is written and no reports are sent.'
              : `Sends 9 keymap reports to ${device.config.name} (${device.config.pid.toUpperCase()}). Lighting is not sent.`}
          </li>
          <li>
            Keys you haven&apos;t remapped get their factory codes: on a Mac, <strong>Win = Command and Alt = Option</strong>.
          </li>
          {isObservedModel ? (
            <>
              <li>
                On this RK61 (0055) this was observed to turn off the keyboard&apos;s own Fn+S Mac switching; unplugging
                doesn&apos;t undo it.
              </li>
              <li>
                Getting native behavior back needed the keyboard&apos;s own reset (Fn+Space, then Fn+S), which may clear
                onboard remaps, lighting and pairings.
              </li>
            </>
          ) : (
            <li>This model hasn&apos;t been tested with this app. Its own Mac/Windows switch may change.</li>
          )}
        </ul>
        <p className="text-xs text-muted-foreground">The keyboard can&apos;t be read back; the app can&apos;t confirm the result.</p>
      </>
    ),
  };
  const handleKeymapConfirmCancel = () => {
    toast.showInfo(draft.keymapPending > 0
      ? `Keymap not sent. Nothing was written; your ${plural(draft.keymapPending, 'key change')} ${draft.keymapPending === 1 ? 'is' : 'are'} still pending.`
      : 'Keymap not sent. Nothing was written.');
  };

  const keymapBar = (
    <PendingChanges
      areaName="key"
      count={draft.keymapPending}
      summary={plural(draft.keymapPending, 'key change')}
      sends="the full keymap (9 reports)"
      otherAreaNote={draft.lightingPending > 0
        ? `Your ${plural(draft.lightingPending, 'pending lighting change')} ${draft.lightingPending === 1 ? 'stays' : 'stay'} pending.`
        : undefined}
      busy={draft.applying === 'keymap'}
      locked={locked}
      failed={keymapFailed}
      blockedReason={disconnectedReason}
      isDemo={isDemo}
      confirm={keymapConfirm}
      onConfirmCancel={handleKeymapConfirmCancel}
      onApply={() => draft.apply('keymap')}
      onDiscard={() => draft.discard('keymap')}
    />
  );

  const colorsHeldBack = draft.colorsPending > 0 && !draft.colorsSendable;
  const customName = draft.customMode !== null
    ? device.config.lightingModes.find(m => m.index === draft.customMode)?.name ?? `mode ${draft.customMode}`
    : '';
  const lightingSummary = [
    draft.settingsPending > 0 && plural(draft.settingsPending, 'setting'),
    draft.colorsPending > 0 && plural(draft.colorsPending, 'key color'),
  ].filter(Boolean).join(' · ');
  const lightingSendable = draft.settingsPending > 0 || (draft.colorsSendable && draft.colorsPending > 0);
  const lightingSends = draft.colorsSendable
    ? 'lighting settings + per-key colors for every key (1 + 7 reports)'
    : 'lighting settings (1 report)';
  // H3: explicit lighting-only resend of the shown settings when nothing is pending or failed.
  // No keymap equivalent (H2: whole-map writes have side effects).
  const lightingFailed = !!draft.errors.lighting || draft.recovery.lighting;
  const lightingResend: ResendOption | null =
    draft.lighting && device.connected && draft.lightingPending === 0 && !lightingFailed
      ? isDemo
        ? {
            label: 'Resend lighting',
            lead: hasLightingRecord
              ? 'The settings shown match the last simulated send.'
              : 'The settings shown are app defaults.',
            detail: `Demo keyboard: resend is simulated and nothing is written. Resend sends ${lightingSends} (simulated).`,
          }
        : hasLightingRecord
          ? {
              label: 'Resend lighting',
              lead: 'The settings shown match what this browser last sent.',
              detail: `The keyboard can’t be read back. If its lighting was changed elsewhere (Fn keys, a reset, RK’s software), you can resend these settings. Resend sends ${lightingSends}.`,
            }
          : {
              label: 'Send shown lighting',
              lead: 'The settings shown are app defaults and have not been sent from this browser.',
              detail: `The keyboard can’t be read back. Send shown lighting sends ${lightingSends}.`,
            }
      : null;
  const lightingBar = (
    <PendingChanges
      areaName="lighting"
      count={draft.lightingPending}
      summary={lightingSummary}
      sends={lightingSends}
      resend={lightingResend}
      otherAreaNote={draft.keymapPending > 0
        ? `Your ${plural(draft.keymapPending, 'pending key change')} ${draft.keymapPending === 1 ? 'stays' : 'stay'} pending.`
        : undefined}
      note={colorsHeldBack
        ? `Per-key colors are sent only with ${customName}; ${plural(draft.colorsPending, 'color edit')} will stay pending until you choose it.`
        : undefined}
      busy={draft.applying === 'lighting'}
      locked={locked}
      failed={lightingFailed}
      blockedReason={disconnectedReason ?? (draft.lightingPending > 0 && !lightingSendable && !lightingFailed
        ? `Choose ${customName} mode to send the per-key colors.`
        : null)}
      isDemo={isDemo}
      onApply={() => draft.apply('lighting')}
      onDiscard={() => draft.discard('lighting')}
    />
  );

  const keyRemapper = (
    <KeyRemapper
      device={device}
      imageManifest={imageManifest}
      draftMappings={draft.mappings}
      onStage={draft.stageMapping}
      locked={locked}
      error={draft.errors.keymap}
      pendingBar={keymapBar}
    />
  );

  const tabCount = (n: number) => n > 0 && (
    <span
      className="ml-2 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs text-white"
      aria-label={`${n} pending`}
    >
      {n}
    </span>
  );

  return (
    <div className="space-y-8">
      {/* DEMO MODE WARNING BANNER */}
      {isDemo && (
        <Alert className="bg-accent/50 border-accent">
          <TriangleAlert className="h-5 w-5 text-accent-foreground" />
          <AlertDescription className="text-accent-foreground">
            <div className="flex flex-col gap-2">
              <div className="font-bold text-base">DEMO MODE - No Keyboard Connected</div>
              <div className="text-sm">
                You are exploring the interface without a physical keyboard. All operations are simulated — changes are not saved and nothing is written to hardware.
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* OFFICIAL RK WEB SOFTWARE BANNER */}
      {isRKWebSoftwareSupported(device.config.pid) && (
        <Alert className="border-primary/30 bg-primary/5">
          <ExternalLink className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            <p>This keyboard may also be supported by <a href={RK_WEB_SOFTWARE_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">RK&apos;s official web configurator</a> (dated list, not verified here), which supports macros and media keys.</p>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                {isDemo ? 'Demo Keyboard' : 'Connected Device'}
              </p>
              <h2 className="text-lg font-semibold text-card-foreground">
                {device.config.name}
                {isDemo && <span className="ml-2 text-sm font-medium text-primary">(DEMO)</span>}
              </h2>
              <p className="text-sm font-normal text-muted-foreground mt-1">
                <span className="whitespace-nowrap">VID: {device.hidDevice.vendorId.toString(16).toUpperCase().padStart(4, '0')}</span>
                {' · '}
                <span className="whitespace-nowrap">PID: {device.config.pid.toUpperCase()}</span>
              </p>
              <EvidenceAndStatus device={device} draft={draft} hasRecord={hasRecord} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {isDemo && (
                <Button
                  onClick={() => setShowKeyboardSwitcher(!showKeyboardSwitcher)}
                  variant="secondary"
                  size="sm"
                >
                  Switch Keyboard
                </Button>
              )}
              <Button
                onClick={() => onDisconnect(device)}
                variant="outline"
                size="sm"
              >
                {isDemo ? 'Exit Demo' : 'Disconnect'}
              </Button>
            </div>
          </div>

          {/* Keyboard Switcher */}
          {isDemo && showKeyboardSwitcher && (
            <div className="mt-4 pt-4 border-t border-border">
              <KeyboardSelector
                keyboards={keyboards}
                onSelect={handleSwitchKeyboard}
                currentPid={device.config.pid}
                showRandom={true}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tab switcher - only show if keyboard has lighting */}
      {hasLighting && (
        <Card className="overflow-visible">
          <div className="flex flex-col items-center gap-3 py-4 px-6">
            <div className="inline-flex bg-muted border border-border rounded-lg p-1 shrink-0" role="tablist" aria-label="Device configuration tabs">
              <button
                onClick={() => setActiveTab('keys')}
                role="tab"
                aria-selected={activeTab === 'keys'}
                aria-controls="keys-panel"
                id="keys-tab"
                className={`px-6 py-2 text-sm font-medium rounded-md transition-all cursor-pointer whitespace-nowrap inline-flex items-center ${
                  activeTab === 'keys'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                Key Mapping{tabCount(draft.keymapPending)}
              </button>
              <button
                onClick={() => setActiveTab('lighting')}
                role="tab"
                aria-selected={activeTab === 'lighting'}
                aria-controls="lighting-panel"
                id="lighting-tab"
                className={`px-6 py-2 text-sm font-medium rounded-md transition-all cursor-pointer whitespace-nowrap inline-flex items-center ${
                  activeTab === 'lighting'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                Lighting{tabCount(draft.lightingPending)}
              </button>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Each tab applies separately. Switching tabs keeps pending changes and sends nothing.
            </p>
            {activeTab === 'keys' && (
              <KeyRemapperActionButton
                draftOverrideCount={draft.mappings.size}
                onStageResetAll={draft.stageResetAllMappings}
                disabled={locked}
              />
            )}
          </div>
          <CardContent>
            <div
              id="keys-panel"
              role="tabpanel"
              aria-labelledby="keys-tab"
              className={activeTab === 'keys' ? '' : 'hidden'}
            >
              {keyRemapper}
            </div>
            {/* Lazy mount on first visit, then keep mounted; the draft lives above, so nothing is lost or sent */}
            {lightingTabVisitedRef.current && (
              <div
                id="lighting-panel"
                role="tabpanel"
                aria-labelledby="lighting-tab"
                className={activeTab === 'lighting' ? '' : 'hidden'}
              >
                <LightingControls
                  device={device}
                  imageManifest={imageManifest}
                  draft={draft}
                  hasLightingRecord={hasLightingRecord}
                  locked={locked}
                  pendingBar={lightingBar}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* No tabs if keyboard doesn't have lighting */}
      {!hasLighting && (
        <Card className="overflow-visible">
          <div className="flex flex-col items-center gap-3 pt-4 px-6">
            <KeyRemapperActionButton
              draftOverrideCount={draft.mappings.size}
              onStageResetAll={draft.stageResetAllMappings}
              disabled={locked}
            />
          </div>
          <CardContent>
            {keyRemapper}
          </CardContent>
        </Card>
      )}

      <SavedInBrowserCard device={device} draft={draft} record={record} />
    </div>
  );
}
