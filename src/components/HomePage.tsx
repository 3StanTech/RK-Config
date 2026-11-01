import { useState, useEffect, useRef, useMemo, memo, useCallback } from 'react';
import { getRKDevices } from '../utils/rkConfig';
import { ConnectButton } from './ConnectButton';
import { KeyboardSelector } from './KeyboardSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Search, Rocket } from 'lucide-react';
import type { ImageManifest } from '../utils/buildImageManifest';
import { useDevices } from '../hooks/useDevices';
import { isRKWebSoftwareSupported, RK_WEB_SOFTWARE_URL } from '../constants/rkWebSoftware';
import { EVIDENCE_RECORDS } from '../constants/deviceEvidence';
import type { DeviceFeature } from '../constants/deviceCapabilities';

const FEATURE_NAMES: Record<DeviceFeature, string> = {
  keymap: 'key remapping',
  globalLighting: 'lighting',
  perKeyColor: 'per-key RGB',
};

/** Catalog evidence label for one model; only recorded evidence raises it above "config file only". */
function catalogEvidence(pid: string): { label: string; title: string; className: string } {
  const records = EVIDENCE_RECORDS.filter(r => r.pid === pid.toLowerCase());
  const verified = records.filter(r => r.level === 'verified-fork');
  if (verified.length > 0) {
    const names = [...new Set(verified.map(r => FEATURE_NAMES[r.feature]))].join(', ');
    return {
      label: `Verified: ${names}`,
      title: `Physically verified with this app (${verified.map(r => `${FEATURE_NAMES[r.feature]} ${r.transport.toUpperCase()} ${r.recordedOn}`).join('; ')}). Other features remain experimental.`,
      className: 'border-green-500/50 bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300',
    };
  }
  if (records.length > 0) {
    return {
      label: 'Experimental · source-checked',
      title: `Configuration and protocol checked from source for ${[...new Set(records.map(r => FEATURE_NAMES[r.feature]))].join(', ')}; not yet confirmed on hardware with this app.`,
      className: 'border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    };
  }
  return {
    label: 'Config file only',
    title: 'Listed in the official RK configuration files; untested with this app.',
    className: 'border-border text-muted-foreground',
  };
}

interface KeyboardListItemProps {
  pid: string;
  name: string;
  isExpanded: boolean;
  onToggle: (pid: string) => void;
  imageManifest?: ImageManifest;
}

const KeyboardListItem = memo(function KeyboardListItem({ pid, name, isExpanded, onToggle, imageManifest }: KeyboardListItemProps) {
    const [showRgb, setShowRgb] = useState<boolean>(false);
    const [standardLoaded, setStandardLoaded] = useState<boolean>(false);
    const [rgbLoaded, setRgbLoaded] = useState<boolean>(false);
    const [hasRequestedStandard, setHasRequestedStandard] = useState<boolean>(false);
    const [hasRequestedRgb, setHasRequestedRgb] = useState<boolean>(false);

    // Get image info from manifest (pre-computed at build time)
    // Memoize to keep stable reference across re-renders
    const pidUpper = pid.toUpperCase();
    const imageInfo = useMemo(() => {
      let info = imageManifest?.[pidUpper];

      // Handle kbImgUse references
      if (info?.kbImgUse && imageManifest) {
        const refInfo = imageManifest[info.kbImgUse.toUpperCase()];
        if (refInfo) {
          info = { ...refInfo, kbImgUse: undefined }; // Use referenced keyboard's images
        }
      }

      return info;
    }, [imageManifest, pidUpper]);

    const hasImage = imageInfo && (imageInfo.hasKeyimg || imageInfo.hasKbled);
    const hasBothImages = imageInfo?.hasKeyimg && imageInfo?.hasKbled;

    // Default to RGB images if available
    useEffect(() => {
      if (hasBothImages) {
        setShowRgb(true);
      } else if (imageInfo?.useRgbDefault !== undefined) {
        setShowRgb(imageInfo.useRgbDefault);
      }
    }, [hasBothImages, imageInfo?.useRgbDefault]);

    const standardImageUrl = imageInfo && hasImage && imageInfo.hasKeyimg
      ? `${import.meta.env.BASE_URL}rk/Dev/${imageInfo.dirCase}/keyimg.png`
      : null;

    const rgbImageUrl = imageInfo && hasImage && imageInfo.hasKbled
      ? `${import.meta.env.BASE_URL}rk/Dev/${imageInfo.dirCase}/kbled.png`
      : null;

    const currentImageUrl = showRgb ? rgbImageUrl : standardImageUrl;
    const currentImageLoaded = showRgb ? rgbLoaded : standardLoaded;

    // Reset state when collapsed
    useEffect(() => {
      if (!isExpanded) {
        setStandardLoaded(false);
        setRgbLoaded(false);
        setHasRequestedStandard(false);
        setHasRequestedRgb(false);
      }
    }, [isExpanded]);

    // Request images based on which view is active
    useEffect(() => {
      if (!isExpanded) return;

      if (showRgb && !hasRequestedRgb) {
        setHasRequestedRgb(true);
      } else if (!showRgb && !hasRequestedStandard) {
        setHasRequestedStandard(true);
      }
    }, [isExpanded, showRgb, hasRequestedRgb, hasRequestedStandard]);

    const handleStandardLoad = () => {
      setStandardLoaded(true);
    };

    const handleRgbLoad = () => {
      setRgbLoaded(true);
    };

    const expandedPanelId = `kb-${pidUpper}-panel`;
    const evidence = catalogEvidence(pid);

    // Get dimensions from manifest (pre-computed at build time)
    const standardDims = imageInfo?.keyimgDimensions;
    const rgbDims = imageInfo?.kbledDimensions;

    // Calculate aspect ratio (width/height) for the current view
    const currentDims = showRgb ? rgbDims : standardDims;
    const aspectRatio = currentDims ? currentDims.width / currentDims.height : undefined;

    return (
      <li className="border-b border-border last:border-b-0">
      <button
        onClick={() => onToggle(pid)}
        className="w-full text-left px-4 py-2 hover:bg-accent transition-colors flex items-center justify-between cursor-pointer text-foreground"
        aria-expanded={isExpanded}
        aria-controls={expandedPanelId}
      >
        <span className="text-sm flex flex-wrap items-center gap-2">
          <span><span className="font-mono text-muted-foreground">{pid.toUpperCase()}</span> - {name}</span>
          <span
            className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium shrink-0 ${evidence.className}`}
            title={evidence.title}
          >
            {evidence.label}
          </span>
          {isRKWebSoftwareSupported(pid) && (
            <a
              href={RK_WEB_SOFTWARE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              Use RK Official Web App
            </a>
          )}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          {isExpanded ? 'Hide Image' : 'Show Image'}
          <svg
            className={`w-4 h-4 transition-transform shrink-0 ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </button>
      {isExpanded && (
        <div id={expandedPanelId} className="px-4 py-3 bg-muted">
          {hasImage && currentImageUrl ? (
            <>
              {hasBothImages && (
                <div className="mb-3 flex justify-end">
                  <div className="inline-flex items-center gap-1 bg-background border rounded-md p-1">
                    <Button
                      onClick={() => setShowRgb(false)}
                      variant={!showRgb ? "default" : "ghost"}
                      size="sm"
                    >
                      Standard
                    </Button>
                    <Button
                      onClick={() => setShowRgb(true)}
                      variant={showRgb ? "default" : "ghost"}
                      size="sm"
                    >
                      RGB
                    </Button>
                  </div>
                </div>
              )}
              <div
                className="relative w-full mx-auto"
                style={{
                  aspectRatio: aspectRatio ? `${aspectRatio}` : undefined,
                  maxWidth: currentDims?.width ? `${currentDims.width}px` : undefined
                }}
              >
                {/* Loading spinner - shown while image loads */}
                {!currentImageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                  </div>
                )}
                {/* Standard image with SVG background - mount once requested, keep mounted */}
                {hasRequestedStandard && standardImageUrl && imageInfo?.luminance && standardDims && (
                  <svg
                    key={`svg-${standardImageUrl}`}
                    viewBox={`0 0 ${standardDims.width} ${standardDims.height}`}
                    className={`absolute inset-0 w-full h-full ${!showRgb && standardLoaded ? 'kb-img-visible' : 'kb-img-hidden'}`}
                    role="img"
                    aria-label={`${name} keyboard layout`}
                    aria-hidden={showRgb}
                  >
                    {/* Render single large background rect for majority */}
                    <rect
                      x={imageInfo.luminance.keyboardBounds[0]}
                      y={imageInfo.luminance.keyboardBounds[1]}
                      width={imageInfo.luminance.keyboardBounds[2] - imageInfo.luminance.keyboardBounds[0]}
                      height={imageInfo.luminance.keyboardBounds[3] - imageInfo.luminance.keyboardBounds[1]}
                      fill={imageInfo.luminance.majorityBackground}
                    />
                    {/* Render small rects only for exception keys */}
                    {imageInfo.luminance.exceptionKeys.map((exceptionKey, index) => {
                      const [left, top, right, bottom] = exceptionKey.rect;
                      return (
                        <rect
                          key={`exception-${index}`}
                          x={left}
                          y={top}
                          width={right - left}
                          height={bottom - top}
                          fill={exceptionKey.background}
                        />
                      );
                    })}
                    <image
                      href={standardImageUrl}
                      x="0"
                      y="0"
                      width={standardDims.width}
                      height={standardDims.height}
                      onLoad={handleStandardLoad}
                    />
                  </svg>
                )}
                {/* Standard image without luminance data - mount once requested, keep mounted */}
                {hasRequestedStandard && standardImageUrl && !imageInfo?.luminance && (
                  <img
                    key={`img-${standardImageUrl}`}
                    src={standardImageUrl}
                    alt={`${name} keyboard layout`}
                    className={`absolute inset-0 w-full h-full object-contain ${!showRgb && standardLoaded ? 'kb-img-visible' : 'kb-img-hidden'}`}
                    aria-hidden={showRgb}
                    onLoad={handleStandardLoad}
                    decoding="async"
                  />
                )}
                {/* RGB image - mount once requested, keep mounted */}
                {hasRequestedRgb && rgbImageUrl && (
                  <img
                    key={`img-${rgbImageUrl}`}
                    src={rgbImageUrl}
                    alt={`${name} keyboard layout with RGB lighting`}
                    className={`absolute inset-0 w-full h-full object-contain ${showRgb && rgbLoaded ? 'kb-img-visible' : 'kb-img-hidden'}`}
                    aria-hidden={!showRgb}
                    onLoad={handleRgbLoad}
                    decoding="async"
                  />
                )}
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">No image available</div>
          )}
        </div>
      )}
    </li>
  );
});

interface HomePageProps {
  initialKeyboards?: Array<{ pid: string; name: string }>;
  imageManifest?: ImageManifest;
}

export function HomePage({ initialKeyboards, imageManifest }: HomePageProps = {}) {
  const [keyboards, setKeyboards] = useState<Array<{ pid: string; name: string }>>(initialKeyboards || []);
  const [filterQuery, setFilterQuery] = useState('');
  const [expandedPids, setExpandedPids] = useState<Set<string>>(new Set());
  const [showTopShadow, setShowTopShadow] = useState(false);
  const [showBottomShadow, setShowBottomShadow] = useState(true);
  const [showDemoSelector, setShowDemoSelector] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
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

  // Reset expanded items and scroll when filter query changes
  useEffect(() => {
    setExpandedPids(new Set());
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [filterQuery]);

  const toggleExpanded = useCallback((pid: string) => {
    setExpandedPids(prev => {
      const next = new Set(prev);
      if (next.has(pid)) {
        next.delete(pid);
      } else {
        next.add(pid);
      }
      return next;
    });
  }, []);

  // Filter keyboards based on filter query (by name or PID, case-insensitive)
  const filteredKeyboards = filterQuery
    ? keyboards.filter(kb =>
        kb.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
        kb.pid.toLowerCase().includes(filterQuery.toLowerCase())
      )
    : keyboards;

  // Update shadows when filtered list changes
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      const isScrollable = container.scrollHeight > container.clientHeight;
      setShowTopShadow(false); // Always reset to top
      setShowBottomShadow(isScrollable);
    }
  }, [filteredKeyboards.length]);

  const handleExpandAllToggle = () => {
    if (expandedPids.size > 0) {
      // Hide all
      setExpandedPids(new Set());
    } else {
      // Show all - expand all filtered keyboards
      setExpandedPids(new Set(filteredKeyboards.map(kb => kb.pid)));
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    // Only show shadows if content is scrollable
    const isScrollable = scrollHeight > clientHeight;

    // Show top shadow if scrolled down from top
    setShowTopShadow(isScrollable && scrollTop > 0);

    // Show bottom shadow if not at bottom (with 1px tolerance)
    setShowBottomShadow(isScrollable && scrollTop + clientHeight < scrollHeight - 1);
  };

  const handleEnterDemoMode = async (pid: string) => {
    await enterDemoMode(pid);
    setShowDemoSelector(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Hero Section with CTA */}
      <header className="text-center py-8">
        <h1 className="text-4xl font-bold text-foreground mb-3">
          Open source Royal Kludge software<br />for Mac, Linux, and Windows
        </h1>
        <p className="text-xl text-muted-foreground">
          Remap keys, compose modifier chords and paint per-key colors in your browser — then Apply when you&apos;re ready
        </p>
        <p className="text-sm text-muted-foreground mt-2 mb-4">
          RK Configurator is unofficial software, not affiliated with Royal Kludge.<br />
          A modified version of <a href="https://github.com/vinc3m1/kludgeknight" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">KludgeKnight</a> by Vince Mi,
          built through reverse engineering and referencing other works like <a href="https://rnayabed.github.io/rangoli_website/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Rangoli</a>.<br />
          Source for this version: <a href="https://github.com/3StanTech/RK-Config" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">3StanTech/RK-Config</a>.
        </p>

        {/* GitHub Link */}
        <a
          href="https://github.com/vinc3m1/kludgeknight"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center text-base text-foreground/80 hover:text-foreground transition-colors mb-6"
        >
          <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 24 24">
            <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
          </svg>
          View upstream KludgeKnight source on GitHub
        </a>

        {/* CTA - Connect Keyboard & Demo Mode */}
        <div className="flex flex-col items-center gap-4">
          <ConnectButton />

          <div className="flex items-center gap-3">
            <div className="h-px bg-border w-16"></div>
            <span className="text-sm text-muted-foreground">or</span>
            <div className="h-px bg-border w-16"></div>
          </div>

          <Button
            onClick={() => setShowDemoSelector(!showDemoSelector)}
            variant="outline"
            size="lg"
            className="px-8 py-6 text-lg"
          >
            <Rocket className="w-5 h-5 mr-2" />
            {showDemoSelector ? 'Hide Demo Mode' : 'Try Demo Mode'}
          </Button>

          {/* Demo Mode Keyboard Selector */}
          {showDemoSelector && (
            <Card className="w-full mt-4">
              <CardHeader>
                <CardTitle>Select a Keyboard to Demo</CardTitle>
              </CardHeader>
              <CardContent>
                <Alert className="mb-4">
                  <AlertDescription>
                    Demo mode lets you explore the interface without connecting a physical keyboard. You can stage edits and press Apply, but Apply is only simulated: nothing is written to hardware or saved in this browser, and a demo apply is never evidence that a model works.
                  </AlertDescription>
                </Alert>

                <KeyboardSelector
                  keyboards={keyboards}
                  onSelect={handleEnterDemoMode}
                  showRandom={true}
                />
              </CardContent>
            </Card>
          )}
        </div>
      </header>

      {/* Features / Value Props */}
      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-lg flex items-center justify-center" aria-hidden="true">
              <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Remap Keys and Chords</h3>
              <p className="text-sm text-muted-foreground">Map a key to another key, or compose a chord from left/right modifiers plus a base key (for example ⌘ Command + C). Edits stay pending until you press Apply, which sends the whole keymap at once.</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-primary rounded-lg flex items-center justify-center" aria-hidden="true">
              <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Lighting and Per-Key Colors</h3>
              <p className="text-sm text-muted-foreground">Set mode, brightness, speed and sleep. On models with an established custom mode (currently the RK61, 0055), paint individual keys or start from a built-in palette. Lighting has its own Apply, separate from the keymap.</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-accent rounded-lg flex items-center justify-center" aria-hidden="true">
              <svg className="w-6 h-6 text-accent-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Runs in Browser</h3>
              <p className="text-sm text-muted-foreground">Uses WebHID API. Works in Chrome, Edge, and Opera. No drivers or admin permissions needed.</p>
            </div>
          </div>

          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0 w-10 h-10 bg-accent rounded-lg flex items-center justify-center" aria-hidden="true">
              <svg className="w-6 h-6 text-accent-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-foreground">Cross-Platform</h3>
              <p className="text-sm text-muted-foreground">Works across Windows, Mac, and Linux. The last successfully applied settings and per-key colors are remembered in this browser only.</p>
            </div>
          </div>
          </div>
        </CardContent>
      </Card>

      {/* Privacy Notice */}
      <Card>
        <CardHeader>
          <CardTitle>Everything Runs Locally</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="flex items-start space-x-4">
          <div className="flex-shrink-0" aria-hidden="true">
            <div className="w-12 h-12 bg-secondary rounded-lg flex items-center justify-center">
              <svg className="w-7 h-7 text-secondary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
          </div>
          <div className="flex-1">
            <p className="text-card-foreground">
              A static site with no backend. All configuration happens directly between browser and keyboard via WebHID, and only when you press Apply. Settings are stored in browser localStorage only — no accounts, profiles or uploads.
            </p>
          </div>
        </div>
        </CardContent>
      </Card>

      {/* Getting Started */}
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
        <ol className="space-y-3 text-card-foreground">
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full text-sm font-bold mr-3">1</span>
            <span>Connect Royal Kludge keyboard via USB (Bluetooth not supported)</span>
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full text-sm font-bold mr-3">2</span>
            <span>Click Connect Keyboard button</span>
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full text-sm font-bold mr-3">3</span>
            <span>Select keyboard from browser dialog and click Connect</span>
          </li>
          <li className="flex items-start">
            <span className="flex-shrink-0 w-6 h-6 flex items-center justify-center bg-primary text-primary-foreground rounded-full text-sm font-bold mr-3">4</span>
            <span>Stage changes on the Key Mapping or Lighting tab, check the pending bar, then press Apply to keyboard. Each tab applies separately; Discard drops pending edits without sending anything.</span>
          </li>
        </ol>
        <Alert className="mt-4">
          <AlertDescription>
            This app cannot read the keyboard&apos;s configuration back. The editor starts from what this browser last sent successfully, or from app defaults if it has never sent anything — neither is a reading of the keyboard&apos;s current state. Connecting or opening the page sends nothing.
          </AlertDescription>
        </Alert>
        <Alert className="mt-4">
          <AlertDescription>
            Chrome, Edge, or Opera required (desktop only). WebHID not supported in Firefox/Safari or mobile browsers.
          </AlertDescription>
        </Alert>
        </CardContent>
      </Card>

      {/* Feature Stability */}
      <Card>
        <CardHeader>
          <CardTitle>Feature Evidence</CardTitle>
        </CardHeader>
        <CardContent>
        <p className="text-sm text-muted-foreground mb-4">
          Each model in the list below shows how well its features are backed: <strong>Config file only</strong> (listed in RK&apos;s files, untested with this app), <strong>Experimental · source-checked</strong> (configuration and protocol checked from source, not yet confirmed on hardware), or <strong>Verified</strong> (physically confirmed with this app, per feature and connection). Nothing is marked verified without a recorded hardware run.
        </p>
        <div className="space-y-3">
          <div className="flex items-start">
            <div className="flex-shrink-0 w-28 mr-4">
              <Badge variant="outline">REPORTED UPSTREAM</Badge>
            </div>
            <div>
              <p className="font-semibold text-card-foreground">Key Mapping and Global Lighting</p>
              <p className="text-sm text-muted-foreground">The upstream KludgeKnight project reports testing on RK F68 and S70 Split. This modified version has not re-tested those models.</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 w-28 mr-4">
              <Badge className="bg-amber-50 text-amber-900 border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-200">EXPERIMENTAL</Badge>
            </div>
            <div>
              <p className="font-semibold text-card-foreground">Modifier Chords</p>
              <p className="text-sm text-muted-foreground">Left and right Control, Shift, Option/Alt and Command/Win bits are sent exactly as chosen, with no automatic Mac/Windows swap. Tested on one RK61 (0055) over USB: Menu → Left Command+C, and Fn+1 produced F1 followed by Digit1, repeated after a power cycle. Other chords, other Fn functions, models and connections remain unverified.</p>
            </div>
          </div>
          <div className="flex items-start">
            <div className="flex-shrink-0 w-28 mr-4">
              <Badge className="bg-amber-50 text-amber-900 border-amber-500/50 dark:bg-amber-950/40 dark:text-amber-200">EXPERIMENTAL</Badge>
            </div>
            <div>
              <p className="font-semibold text-card-foreground">Per-Key RGB and Palettes</p>
              <p className="text-sm text-muted-foreground">Available only where a custom per-key mode is established for the exact model — currently the RK61 (0055, Customize mode 14), from its configuration files. On that model over USB, a Q/W/E red/green/blue test and a WASD palette were confirmed, the palette surviving a power cycle; other palettes and connections remain unverified. Other RGB models get global lighting only.</p>
            </div>
          </div>
        </div>
        </CardContent>
      </Card>

      {/* Important Limitations */}
      <Card>
        <CardHeader>
          <CardTitle>Limitations</CardTitle>
        </CardHeader>
        <CardContent>
        <ul className="space-y-3 text-card-foreground">
          <li className="flex items-start">
            <svg className="flex-shrink-0 w-5 h-5 text-accent mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-card-foreground">Can&apos;t read existing mappings from keyboard</p>
              <p className="text-sm text-muted-foreground">This app has no configuration readback; whether RK firmware offers any undocumented read method is unproven. The app starts from the last state this browser sent successfully (or defaults) and can&apos;t confirm what the keyboard holds. If a transfer fails part-way, the keyboard may be partly updated; there is no rollback, so apply again.</p>
            </div>
          </li>
          <li className="flex items-start">
            <svg className="flex-shrink-0 w-5 h-5 text-accent mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-card-foreground">Settings only saved in browser localStorage</p>
              <p className="text-sm text-muted-foreground">One record per keyboard holds the last applied keymap, lighting and per-key colors — no named profiles or import/export. It stays local to one browser and one site address; clearing browser data, switching browsers or opening the app from another address starts from defaults. If storage is full, an Apply still reaches the keyboard but isn&apos;t remembered, and the app says so.</p>
            </div>
          </li>
          <li className="flex items-start">
            <svg className="flex-shrink-0 w-5 h-5 text-accent mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-card-foreground">Classic RK protocol only, by USB</p>
              <p className="text-sm text-muted-foreground">The app writes only to keyboards whose configuration interface matches the classic RK format (feature report 0x0A, 64 bytes) and whose exact model has a shipped configuration. Other or newer RK protocols are refused before anything is sent; use RK&apos;s own software for those. Bluetooth and 2.4 GHz are not supported.</p>
            </div>
          </li>
        </ul>
        </CardContent>
      </Card>

      {/* Model catalog */}
      <Card>
        <CardHeader>
          <CardTitle>Model Catalog</CardTitle>
        </CardHeader>
        <CardContent>
        <p className="text-muted-foreground mb-2">
          {keyboards.length} RK keyboard models listed.
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Configurations from official RK Windows software (Oct 2025). A listed model is browsable in demo mode; it is not proof the model works with this app — see each model&apos;s evidence label.
        </p>
        {keyboards.length > 0 ? (
          <>
            {/* Filter input */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-accent" />
                <Input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  placeholder="Filter by model name or PID..."
                  className="pl-10 w-full"
                />
              </div>
            </div>

            {filteredKeyboards.length > 0 ? (
              <>
                {/* Show/Hide All Images button */}
                <div className="mb-3 flex justify-end">
                  <Button
                    onClick={handleExpandAllToggle}
                    variant="ghost"
                    size="sm"
                  >
                    {expandedPids.size > 0 ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                        Hide All Images
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                        Show All Images
                      </>
                    )}
                  </Button>
                </div>

                <div className="relative border border-border bg-muted rounded-md overflow-hidden" style={{ height: '480px' }}>
                  {/* Top shadow overlay */}
                  {showTopShadow && (
                    <div
                      className="absolute top-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-b from-foreground/10 to-transparent"
                    />
                  )}

                  {/* Bottom shadow overlay */}
                  {showBottomShadow && (
                    <div
                      className="absolute bottom-0 left-0 right-0 h-4 pointer-events-none z-10 bg-gradient-to-t from-foreground/10 to-transparent"
                    />
                  )}

                  <div className="h-full overflow-y-auto" onScroll={handleScroll} ref={scrollContainerRef}>
                    <ul className="divide-y divide-border">
                      {filteredKeyboards.map(kb => (
                        <KeyboardListItem
                          key={kb.pid}
                          pid={kb.pid}
                          name={kb.name}
                          isExpanded={expandedPids.has(kb.pid)}
                          onToggle={toggleExpanded}
                          imageManifest={imageManifest}
                        />
                      ))}
                    </ul>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-center py-8">No keyboards found matching "{filterQuery}"</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">Loading keyboard list...</p>
        )}
        </CardContent>
      </Card>

      {/* License */}
      <Card>
        <CardHeader>
          <CardTitle>License</CardTitle>
        </CardHeader>
        <CardContent>
        <div className="text-sm text-card-foreground space-y-2 font-mono bg-muted p-4 rounded border border-border">
          <p>Kludge Knight - Browser-based Software for Royal Kludge Keyboards</p>
          <p>Copyright (C) 2025 Vince Mi (vinc3m1)</p>
          <p>RK Configurator is a modified version of Kludge Knight (2026), distributed under the same license.</p>
          <p className="pt-2">
            This program is free software: you can redistribute it and/or modify
            it under the terms of the GNU General Public License as published by
            the Free Software Foundation, either version 3 of the License, or
            (at your option) any later version.
          </p>
          <p>
            This program is distributed in the hope that it will be useful,
            but WITHOUT ANY WARRANTY; without even the implied warranty of
            MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
            GNU General Public License for more details.
          </p>
        </div>
        </CardContent>
      </Card>

    </div>
  );
}
