import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { getRKDevices } from '../utils/rkConfig';
import { ConnectButton } from './ConnectButton';
import { DemoPickerDialog } from './DemoPickerDialog';
import { HeroKeyboard } from './HeroKeyboard';
import { Button } from '@/components/ui/button';
import { Check, CircleCheck, Cpu, ExternalLink, Keyboard, Lightbulb, Play, Search, TriangleAlert } from 'lucide-react';
import { useDevices } from '../hooks/useDevices';
import { isRKWebSoftwareSupported, RK_WEB_SOFTWARE_URL } from '../constants/rkWebSoftware';
import { EVIDENCE_RECORDS } from '../constants/deviceEvidence';
import type { DeviceFeature } from '../constants/deviceCapabilities';

const FEATURE_NAMES: Record<DeviceFeature, string> = {
  keymap: 'key remapping',
  globalLighting: 'lighting',
  perKeyColor: 'per-key RGB',
};

type EvidenceLevel = 'verified' | 'source' | 'config';

// Evidence pills: the signal hue tints the pill and its mark; the label keeps the theme's own
// foreground so it stays as legible as body text in every preset.
const BADGE_CLASS: Record<EvidenceLevel, string> = {
  verified: 'bg-[color-mix(in_srgb,#22c55e_10%,var(--background))] text-foreground',
  source: 'bg-[color-mix(in_srgb,#f59e0b_12%,var(--background))] text-foreground',
  // Outline only: some presets' muted fill is too close to every text colour
  config: 'border border-border text-foreground',
};

/** Catalog evidence label for one model; only recorded evidence raises it above "config file only". */
function catalogEvidence(pid: string): { label: string; title: string; level: EvidenceLevel } {
  const records = EVIDENCE_RECORDS.filter(r => r.pid === pid.toLowerCase());
  const verified = records.filter(r => r.level === 'verified-fork');
  if (verified.length > 0) {
    const names = [...new Set(verified.map(r => FEATURE_NAMES[r.feature]))].join(', ');
    return {
      label: `Verified: ${names}`,
      title: `Physically verified with this app (${verified.map(r => `${FEATURE_NAMES[r.feature]} ${r.transport.toUpperCase()} ${r.recordedOn}`).join('; ')}). Other features remain experimental.`,
      level: 'verified',
    };
  }
  if (records.length > 0) {
    return {
      label: 'Experimental · source-checked',
      title: `Configuration and protocol checked from source for ${[...new Set(records.map(r => FEATURE_NAMES[r.feature]))].join(', ')}; not yet confirmed on hardware with this app.`,
      level: 'source',
    };
  }
  return {
    label: 'Config file only',
    title: 'Listed in the official RK configuration files; untested with this app.',
    level: 'config',
  };
}

function EvidenceBadge({ level, title, children }: { level: EvidenceLevel; title?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap max-sm:whitespace-normal ${BADGE_CLASS[level]}`}
      title={title}
    >
      {level === 'verified' && <Check className="size-3 text-[#16a34a]" aria-hidden="true" />}
      {level === 'source' && <span className="size-1.5 rounded-full bg-[#f59e0b]" aria-hidden="true" />}
      {children}
    </span>
  );
}

const BENEFITS = [
  {
    icon: Keyboard,
    title: 'Remap keys and chords.',
    body: 'Map a key to another key, a media function, or a chord such as ⌘ Command + C, with left and right modifiers kept separate.',
  },
  {
    icon: Lightbulb,
    title: 'Paint per-key colors.',
    body: 'Set mode, brightness, speed and sleep, then paint single keys or start from a built-in palette on models with an established custom mode (currently the RK61 0055).',
  },
  {
    icon: CircleCheck,
    title: 'Nothing sent until Apply.',
    body: 'Edits stay pending. Key Mapping and Lighting each have their own Apply and Discard, and every keymap send asks first.',
  },
  {
    icon: Cpu,
    title: 'Evidence for every model.',
    body: "Each listed model shows whether a feature is only in RK's files, checked from source, or verified on hardware with this app.",
  },
];

const STEPS = [
  { title: 'Connect over USB.', body: 'Plug in the keyboard and pick it in the browser dialog. Connecting sends nothing.' },
  { title: 'Stage your edits.', body: 'Change keys, chords and lighting. The pending count shows what is waiting.' },
  { title: 'Review and Apply.', body: "Apply sends only that tab's changes. A keymap Apply replaces the whole map (9 reports) after you confirm." },
];

const SAFETY: Array<{ title: string; body: ReactNode }> = [
  { title: 'No readback.', body: "The app can't read the keyboard's settings. It starts from what this browser last sent, or from app defaults." },
  { title: 'Whole map every time.', body: "Each Key Mapping Apply sends the complete keymap, including keys you didn't touch." },
  {
    title: 'Mac mode on the tested RK61.',
    body: (
      <>
        On the RK61 0055, any keymap send turned off the keyboard&apos;s own Mac mode. What brought it back: hold Fn+Space
        until the backlight flashes, then Fn+S. Then use <strong className="text-card-foreground">Resend lighting</strong> to
        restore your colors.
      </>
    ),
  },
  { title: 'No rollback.', body: 'If a transfer fails part-way the keyboard may be partly updated. Apply again.' },
];

const LABEL_KEY: Array<{ level: EvidenceLevel; label: string; body: string }> = [
  { level: 'config', label: 'Config file only', body: "listed in RK's files, untested with this app." },
  { level: 'source', label: 'Experimental · source-checked', body: 'configuration and protocol checked from source, not yet confirmed on hardware.' },
  { level: 'verified', label: 'Verified', body: 'physically confirmed with this app, per feature and connection.' },
];

const FAQ = [
  { q: 'Which browsers work?', a: "Desktop Chrome, Edge or Opera. Firefox, Safari and mobile browsers don't support WebHID." },
  { q: 'Does it work on a Mac?', a: "Yes, in one of those browsers. On the tested RK61 a keymap send turns off the keyboard's own Mac mode; see Before you write a keymap." },
  { q: 'Will it work with my keyboard?', a: "Only models with a shipped RK configuration that use the classic RK report over USB. Others are refused before anything is sent. Check your model's evidence label." },
  { q: 'Can it read my current settings?', a: 'No. It shows what this browser last sent, or app defaults.' },
  { q: 'Where are my settings saved?', a: 'In this browser only: one record per keyboard with the last applied keymap, lighting and per-key colors. No accounts, profiles or uploads.' },
  { q: 'Does Bluetooth or 2.4 GHz work?', a: 'No. Use a USB cable.' },
  { q: 'Can I try it without a keyboard?', a: 'Yes. Demo mode opens any listed model. Apply is simulated: nothing is written to hardware or saved.' },
  { q: 'Is this official RK software?', a: 'No. It is unofficial and not affiliated with Royal Kludge. It is a modified version of KludgeKnight by Vince Mi, released under GPL-3.0.' },
];

const README_SAFETY_URL = 'https://github.com/3StanTech/RK-Config#before-you-write-a-keymap-tested-rk61-258a0055-findings';

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="mb-[30px] text-center">
      <h2 id={id} className="text-[clamp(26px,3.4vw,40px)] font-extrabold tracking-[-0.03em]">{title}</h2>
      {lead && <p className="mx-auto mt-2.5 max-w-[62ch] text-muted-foreground">{lead}</p>}
    </div>
  );
}

const SECTION_CLASS = 'scroll-mt-[90px] pt-24 max-sm:pt-16';

interface HomePageProps {
  initialKeyboards?: Array<{ pid: string; name: string }>;
}

export function HomePage({ initialKeyboards }: HomePageProps = {}) {
  const [keyboards, setKeyboards] = useState<Array<{ pid: string; name: string }>>(initialKeyboards || []);
  const [filterQuery, setFilterQuery] = useState('');
  const demoDialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { enterDemoMode } = useDevices();

  useEffect(() => {
    // Only fetch if we don't have initial data (SSR provides it)
    if (!initialKeyboards) {
      getRKDevices().then(devices => {
        const keyboards = Array.from(devices.entries()).map(([pid, name]) => ({ pid, name }));
        setKeyboards(keyboards);
      });
    }
  }, [initialKeyboards]);

  // Back to the top of the list when the filter changes
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [filterQuery]);

  // Filter keyboards by name or PID, case-insensitive
  const query = filterQuery.toLowerCase();
  const filteredKeyboards = query
    ? keyboards.filter(kb => kb.name.toLowerCase().includes(query) || kb.pid.toLowerCase().includes(query))
    : keyboards;

  const handleDemoPick = async (pid: string) => {
    demoDialogRef.current?.close();
    await enterDemoMode(pid);
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 max-sm:px-4">
      {/* Hero */}
      <section aria-labelledby="hero-title" className="grid justify-items-center pt-14 text-center max-sm:pt-10">
        <p className="float mb-[22px] inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-card-foreground">
          <span aria-hidden="true" className="size-[7px] rounded-full bg-primary" />
          Unofficial · open source · runs in your browser
        </p>
        <h1 id="hero-title" className="max-w-[14ch] text-[clamp(38px,6vw,80px)] leading-[0.98] font-extrabold tracking-[-0.045em]">
          Remap and relight your Royal Kludge keyboard
        </h1>
        <p className="mt-5 max-w-[50ch] text-[18.5px] text-muted-foreground max-sm:text-base">
          Map keys and modifier chords, paint per-key colors, and review every change before anything reaches the keyboard.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-2.5 max-sm:w-full max-sm:flex-col">
          <ConnectButton />
          <Button
            type="button"
            variant="outline"
            onClick={() => demoDialogRef.current?.showModal()}
            className="h-[52px] rounded-full border-border bg-background px-[26px] text-[15.5px] font-bold text-foreground hover:border-ring hover:bg-background dark:bg-background dark:border-border [&_svg:not([class*='size-'])]:size-[17px]"
          >
            <Play aria-hidden="true" />
            Try the demo
          </Button>
        </div>
        <p className="mt-3.5 text-[12.5px] text-muted-foreground">Desktop Chrome, Edge or Opera · USB cable · Mac, Windows, Linux</p>
        <div className="stage3d">
          <div className="tilt">
            <HeroKeyboard />
          </div>
        </div>
        <p className="float relative z-[5] -mt-[26px] inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[13px] max-sm:mt-3 max-sm:items-start max-sm:rounded-[var(--radius)] max-sm:text-left">
          <span aria-hidden="true" className="grid size-5 flex-none place-items-center rounded-full bg-accent text-accent-foreground">
            <Check className="size-3" />
          </span>
          Verified on hardware: RK61 (258A:0055) over USB. Other listed models are experimental.
        </p>
        <p className="mt-2.5 font-mono text-xs text-muted-foreground">RK61 · WASD palette</p>
      </section>

      {/* What it does */}
      <section aria-labelledby="benefits-title" className={SECTION_CLASS}>
        <SectionHead id="benefits-title" title="What it does" />
        <div className="grid grid-cols-4 items-stretch gap-[18px] max-[960px]:grid-cols-2 max-[560px]:grid-cols-1">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <article key={title} className="float p-5">
              <Icon className="mb-[26px] size-[22px] text-primary" aria-hidden="true" />
              <h3 className="mb-2 text-base font-bold">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" aria-labelledby="how-title" className={SECTION_CLASS}>
        <SectionHead id="how-title" title="How it works" />
        <ol className="grid grid-cols-3 gap-[72px] max-[860px]:grid-cols-1 max-[860px]:gap-7">
          {STEPS.map((step, i) => (
            <li key={step.title} className="how-step float relative p-5">
              <span className="inline-grid h-[26px] place-items-center rounded-full bg-accent px-2.5 font-mono text-xs font-semibold text-accent-foreground">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-3.5 mb-1.5 text-[17px] font-bold">{step.title}</h3>
              <p className="text-sm text-muted-foreground">{step.body}</p>
              <span className="how-wire" aria-hidden="true" />
            </li>
          ))}
        </ol>
      </section>

      {/* Before you write a keymap */}
      <section id="safety" aria-labelledby="safety-title" className={SECTION_CLASS}>
        <SectionHead
          id="safety-title"
          title="Before you write a keymap"
          lead="This app talks to the keyboard directly. Four things to know first."
        />
        <div className="float p-2">
          <ul className="grid grid-cols-2 max-[700px]:grid-cols-1">
            {SAFETY.map(item => (
              <li key={item.title} className="flex gap-3.5 p-[18px]">
                <TriangleAlert className="mt-0.5 size-5 flex-none text-[#f59e0b]" aria-hidden="true" />
                <div>
                  <h3 className="mb-1.5 text-[15.5px] font-bold">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="px-[18px] pt-2 pb-3.5">
            <a
              href={README_SAFETY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              Full test notes in the README
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      {/* Model catalog */}
      <section id="models" aria-labelledby="models-title" className={SECTION_CLASS}>
        <SectionHead
          id="models-title"
          title="Model catalog"
          lead={`${keyboards.length} RK keyboard models listed, from the official RK Windows software (Oct 2025). Any listed model can be explored in demo mode; a listing isn't proof the model works with this app.`}
        />
        <div className="float p-[18px]">
          <label className="relative block">
            <Search className="absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Filter by model name or PID…</span>
            <input
              type="search"
              value={filterQuery}
              onChange={e => setFilterQuery(e.target.value)}
              placeholder="Filter by model name or PID…"
              className="h-[46px] w-full rounded-full border border-border bg-background pr-4 pl-[42px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </label>
          <ul className="my-3.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[12.5px] text-muted-foreground">
            {LABEL_KEY.map(item => (
              <li key={item.level}>
                <EvidenceBadge level={item.level}>{item.label}</EvidenceBadge> {item.body}
              </li>
            ))}
          </ul>
          {keyboards.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Loading keyboard list...</p>
          ) : filteredKeyboards.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">No keyboards found matching &quot;{filterQuery}&quot;</p>
          ) : (
            <div ref={listRef} className="max-h-[480px] overflow-y-auto">
              <ul>
                {filteredKeyboards.map(kb => {
                  const evidence = catalogEvidence(kb.pid);
                  return (
                    <li
                      key={kb.pid}
                      className="grid grid-cols-[64px_minmax(0,1fr)_auto_auto] items-center gap-x-3.5 gap-y-2 rounded-[var(--radius)] px-3 py-2.5 text-sm hover:bg-muted max-sm:grid-cols-[48px_minmax(0,1fr)]"
                    >
                      <span className="font-mono text-[12.5px] text-muted-foreground">{kb.pid.toUpperCase()}</span>
                      <span>{kb.name}</span>
                      <span className="min-w-0 max-sm:col-start-2 max-sm:justify-self-start">
                        <EvidenceBadge level={evidence.level} title={evidence.title}>{evidence.label}</EvidenceBadge>
                      </span>
                      <span className="flex items-center gap-2.5 max-sm:col-start-2 max-sm:justify-self-start">
                        {isRKWebSoftwareSupported(kb.pid) && (
                          <a
                            href={RK_WEB_SOFTWARE_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12.5px] text-primary hover:underline"
                          >
                            Use RK official web app
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => enterDemoMode(kb.pid)}
                          aria-label={`Try in demo: ${kb.name}`}
                          className="h-[30px] rounded-full border border-border bg-background px-3 text-[12.5px] font-semibold whitespace-nowrap text-foreground hover:border-primary"
                        >
                          Try in demo
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Questions */}
      <section id="questions" aria-labelledby="questions-title" className={SECTION_CLASS}>
        <SectionHead id="questions-title" title="Questions" />
        <div className="float px-[22px] py-2">
          <dl className="grid grid-cols-2 gap-x-9 max-[760px]:grid-cols-1">
            {FAQ.map((item, i) => (
              <div
                key={item.q}
                className={`border-border py-4 ${i < FAQ.length - 2 ? 'border-b' : 'max-[760px]:border-b max-[760px]:last:border-b-0'}`}
              >
                <dt className="mb-1 font-bold">{item.q}</dt>
                <dd className="text-sm text-muted-foreground">{item.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <DemoPickerDialog ref={demoDialogRef} keyboards={keyboards} onSelect={handleDemoPick} />
    </div>
  );
}
