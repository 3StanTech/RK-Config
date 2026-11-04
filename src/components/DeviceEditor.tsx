import { useState, useRef, useEffect, useMemo } from 'react';
import type { KeyboardDevice } from '../models/KeyboardDevice';
import { KeyRemapper, KeyRemapperActionButton } from './KeyRemapper';
import { LightingControls } from './LightingControls';
import { DemoPickerDialog } from './DemoPickerDialog';
import { PendingChanges, type ConfirmOption, type ResendOption } from './PendingChanges';
import { useToast } from '../hooks/useToast';
import { Button } from '@/components/ui/button';
import { Info, ExternalLink, ChevronDown, Keyboard, Sun, Check } from 'lucide-react';
import { useDevices } from '../hooks/useDevices';
import { useDeviceDraft, type DeviceDraft } from '../hooks/useDeviceDraft';
import { getRKDevices } from '../utils/rkConfig';
import { loadFullProfile, type StoredProfile } from '../utils/profileStorage';
import { firmwareCodeLabel } from '../utils/keyChords';
import { isRKWebSoftwareSupported, RK_WEB_SOFTWARE_URL } from '../constants/rkWebSoftware';
import type { ClassicCapabilities, DeviceFeature } from '../constants/deviceCapabilities';
import { getFeatureEvidence, type EvidenceRecord } from '../constants/deviceEvidence';
import { SLEEP_LABELS, SPEED_LABELS, toHex } from '../utils/lightingPalettes';

type Tab = 'keys' | 'lighting';


interface DeviceEditorProps {
  device: KeyboardDevice;
  onDisconnect: (device: KeyboardDevice) => Promise<void>;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
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
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // The open panel covers the tabs: close it on Escape, an outside press, or focus leaving it
  useEffect(() => {
    if (!open) return;
    const el = detailsRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      el?.querySelector('summary')?.focus();
    };
    const onPointer = (e: PointerEvent) => { if (el && !el.contains(e.target as Node)) setOpen(false); };
    const onFocusOut = (e: FocusEvent) => { if (el && !el.contains(e.relatedTarget as Node | null)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    el?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      el?.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

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
  // Phase 1 badge treatment: theme foreground label, signal hue mixed into the background
  const badgeTone = isDemo
    ? 'border border-border'
    : verifiedCount > 0
      ? 'bg-[color-mix(in_srgb,#22c55e_10%,var(--background))]'
      : 'border border-border';

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

  const chip = 'inline-flex h-7 items-center gap-1.5 rounded-full px-[11px] text-xs font-semibold text-foreground';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <details ref={detailsRef} className="relative" open={open} onToggle={e => setOpen(e.currentTarget.open)}>
        <summary className={`${chip} ${badgeTone} cursor-pointer list-none [&::-webkit-details-marker]:hidden`} aria-controls="evidence-panel">
          {!isDemo && verifiedCount > 0 && <Check className="size-3 text-[#16a34a]" aria-hidden="true" />}
          {badgeText}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </summary>
        <div
          id="evidence-panel"
          className="absolute top-9 left-0 z-40 grid w-[min(420px,calc(100vw-48px))] gap-1.5 rounded-[calc(var(--radius)+4px)] border border-border bg-popover p-3.5 text-[13px] text-popover-foreground shadow-xl"
        >
          <dl className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1.5">
            {rows.map(r => (
              <div key={r.label} className="contents">
                <dt className="font-bold">{r.label}</dt>
                <dd className="text-muted-foreground">{r.verified ? '✔ ' : ''}{r.text}</dd>
              </div>
            ))}
            <dt className="font-bold">Connection</dt>
            <dd className="text-muted-foreground">USB only · feature report 0x0A, 64-byte payload</dd>
          </dl>
          <p className="text-xs text-muted-foreground mt-1.5">
            “Experimental” means the RK configuration files describe this feature; it has not been confirmed on a real{' '}
            {device.config.name} with this app yet.{isDemo ? ' Demo applies are simulations and never count as hardware verification.' : ''}
          </p>
        </div>
      </details>
      <span className={`${chip} border border-border`} aria-live="polite">
        <span className={`h-[7px] w-[7px] rounded-full ${dot}`} aria-hidden="true" />
        {writeText}
      </span>
    </div>
  );
}

function SavedInBrowserCard({ device, draft, record }: { device: KeyboardDevice; draft: DeviceDraft; record: StoredProfile | null }) {
  const isDemo = !!device.isDemo;

  let rows: Array<[string, React.ReactNode]>;
  if (isDemo) {
    rows = [['Status', 'Demo keyboard: nothing is saved in this browser.']];
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
      ? `${modeName} · ${SPEED_LABELS[l.speed - 1]} · brightness ${l.brightness} · sleep ${SLEEP_LABELS[l.sleep - 1]} · ${l.randomColor ? 'random color' : toHex(l.color)}`
      : null;
    const pk = record?.perKeyColors ?? null;
    const pkText = pk
      ? `${plural(new Set(Object.values(pk).map(toHex)).size, 'distinct color')} across ${plural(Object.keys(pk).length, 'key')}`
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
    <div className="space-y-2.5 text-[12.5px]">
        <h3 className="flex flex-col gap-0.5 text-[13px] font-extrabold text-card-foreground">
          Saved in this browser
          <small className="text-xs font-medium text-muted-foreground">localStorage · one record per keyboard · no profiles</small>
        </h3>
        {notSaved && (
          <p className="text-sm text-destructive">
            The last {draft.notSaved.keymap && draft.notSaved.lighting ? 'keymap and lighting applies were' : draft.notSaved.keymap ? 'keymap apply was' : 'lighting apply was'}{' '}
            sent but not saved — browser storage is full or blocked. The saved record below doesn&apos;t include it, and a
            reload will start from that older record or from app defaults.
          </p>
        )}
        <dl className="grid grid-cols-1 gap-y-1.5">
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
    </div>
  );
}

export function DeviceEditor({ device, onDisconnect }: DeviceEditorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('keys');
  const lightingTabVisitedRef = useRef(false);
  const demoDialogRef = useRef<HTMLDialogElement>(null);
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
    demoDialogRef.current?.close();
    await switchDemoKeyboard(pid);
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
      sends="the whole keymap (9 reports)"
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
    ? 'lighting and per-key colors for every key (8 reports: 1 + 7)'
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

  // Shared inspector panels under each view's own panels
  const inspectorFooter = (
    <>
      {isRKWebSoftwareSupported(device.config.pid) && (
        <p className="flex gap-2 text-xs text-muted-foreground">
          <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span>
            This keyboard may also be supported by <a href={RK_WEB_SOFTWARE_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">RK&apos;s official web configurator</a> (dated list, not verified here), which supports macros and media keys.
          </span>
        </p>
      )}
      <SavedInBrowserCard device={device} draft={draft} record={record} />
    </>
  );

  const keyRemapper = (
    <KeyRemapper
      device={device}
      draftMappings={draft.mappings}
      onStage={draft.stageMapping}
      locked={locked}
      error={draft.errors.keymap}
      pendingBar={keymapBar}
      resetButton={
        <KeyRemapperActionButton
          draftOverrideCount={draft.mappings.size}
          onStageResetAll={draft.stageResetAllMappings}
          disabled={locked}
        />
      }
      inspectorFooter={inspectorFooter}
    />
  );

  const tabCount = (n: number) => n > 0 && (
    <span
      className="inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#f59e0b] px-1.5 text-[11.5px] font-extrabold text-[#1a1205]"
      aria-label={`${n} pending`}
    >
      {n}
    </span>
  );

  const tab = (id: Tab, label: string, Icon: typeof Sun, count: number) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      role="tab"
      aria-selected={activeTab === id}
      aria-controls={`${id}-panel`}
      id={`${id}-tab`}
      className={`inline-flex h-[38px] items-center gap-2 rounded-full px-4 text-sm font-bold whitespace-nowrap transition-colors ${
        activeTab === id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
      {tabCount(count)}
    </button>
  );

  const vid = device.hidDevice.vendorId.toString(16).toUpperCase().padStart(4, '0');

  return (
    <div className="ed">
      {isDemo && (
        <p
          role="status"
          className="self-center inline-flex items-center gap-2.5 rounded-full border border-[color-mix(in_srgb,var(--accent-foreground)_18%,transparent)] bg-accent px-4 py-2 text-[13px] text-accent-foreground max-sm:rounded-[var(--radius)]"
        >
          <Info className="size-4 shrink-0" aria-hidden="true" />
          <span><b>Demo mode, no keyboard connected.</b> All operations are simulated. Changes are not saved and nothing is written to hardware.</span>
        </p>
      )}

      <div className="flex flex-col items-start gap-3.5">
        {/* Above the tabs and stage so the evidence popover is never covered; below the z-40 header */}
        <div className="float relative z-30 flex flex-wrap items-center gap-3.5 py-2.5 pr-3 pl-4">
          <div>
            <p className="text-[11.5px] text-muted-foreground">{isDemo ? 'Demo keyboard' : 'Connected keyboard'}</p>
            <h2 className="text-base font-extrabold tracking-[-0.01em]">{device.config.name}</h2>
            <p className="font-mono text-[11.5px] text-muted-foreground">
              <span className="whitespace-nowrap">VID {vid}</span>
              {' · '}
              <span className="whitespace-nowrap">PID {device.config.pid.toUpperCase()}</span>
            </p>
          </div>
          <EvidenceAndStatus device={device} draft={draft} hasRecord={hasRecord} />
          <div className="flex items-center gap-1">
            {isDemo && (
              <Button onClick={() => demoDialogRef.current?.showModal()} variant="outline" size="sm" className="rounded-full font-bold">
                Switch keyboard
              </Button>
            )}
            <Button onClick={() => onDisconnect(device)} variant="ghost" size="sm" className="rounded-full font-bold">
              {isDemo ? 'Exit demo' : 'Disconnect'}
            </Button>
          </div>
        </div>

        {hasLighting && (
          <div className="float inline-flex gap-1 rounded-full p-[5px]" role="tablist" aria-label="Device configuration tabs">
            {tab('keys', 'Key Mapping', Keyboard, draft.keymapPending)}
            {tab('lighting', 'Lighting', Sun, draft.lightingPending)}
          </div>
        )}
      </div>

      {hasLighting && (
        <p className="text-center text-xs text-muted-foreground">
          Each tab applies separately. Switching tabs keeps pending changes and sends nothing.
        </p>
      )}

      <div
        id="keys-panel"
        role={hasLighting ? 'tabpanel' : undefined}
        aria-labelledby={hasLighting ? 'keys-tab' : undefined}
        className="ed-view"
        hidden={hasLighting && activeTab !== 'keys'}
      >
        {keyRemapper}
      </div>
      {/* Lazy mount on first visit, then keep mounted; the draft lives above, so nothing is lost or sent */}
      {hasLighting && lightingTabVisitedRef.current && (
        <div
          id="lighting-panel"
          role="tabpanel"
          aria-labelledby="lighting-tab"
          className="ed-view"
          hidden={activeTab !== 'lighting'}
        >
          <LightingControls
            device={device}
            draft={draft}
            hasLightingRecord={hasLightingRecord}
            locked={locked}
            pendingBar={lightingBar}
            inspectorFooter={inspectorFooter}
          />
        </div>
      )}

      {isDemo && (
        <DemoPickerDialog
          ref={demoDialogRef}
          keyboards={keyboards}
          currentPid={device.config.pid}
          onSelect={pid => { void handleSwitchKeyboard(pid); }}
        />
      )}
    </div>
  );
}
