import { useEffect, useRef } from 'react';
import { useSelectedDevice, useDevices } from '../hooks/useDevices';
import { DeviceEditor } from './DeviceEditor';
import { HomePage } from './HomePage';
import { SiteHeader } from './SiteHeader';
import { SiteFooter } from './SiteFooter';
import { DeviceProvider } from '../context/DeviceContext';
import { ToastProvider } from '../context/ToastContext';
import type { HeroBoard } from './HeroKeyboard';

interface AppProps {
  initialKeyboards?: Array<{ pid: string; name: string }>;
  heroBoard: HeroBoard;
  ledManifest?: string;
}

function AppContent({ initialKeyboards, heroBoard }: AppProps) {
  const device = useSelectedDevice();
  const { disconnectDevice } = useDevices();
  const mainRef = useRef<HTMLElement>(null);
  const deviceId = device?.id;
  const firstRender = useRef(true);

  // Home and editor replace each other in place: start the new view at the top and move focus to it
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [deviceId]);

  return (
    <div className="min-h-screen">
      <SiteHeader deviceName={device?.config.name} />

      <main id="main-content" ref={mainRef} tabIndex={-1} className="outline-none">
        {!device ? (
          <HomePage initialKeyboards={initialKeyboards} heroBoard={heroBoard} />
        ) : (
          <DeviceEditor
            key={device.id}
            device={device}
            onDisconnect={disconnectDevice}
          />
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

// Wrap AppContent with ToastProvider and DeviceProvider
// ToastProvider must be outside DeviceProvider since DeviceProvider uses toast context
export default function App(props: AppProps) {
  return (
    <ToastProvider>
      <DeviceProvider ledManifest={props.ledManifest}>
        <AppContent {...props} />
      </DeviceProvider>
    </ToastProvider>
  );
}
