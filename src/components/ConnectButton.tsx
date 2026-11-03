import { useState, useEffect } from 'react';
import { useDevices } from '../hooks/useDevices';
import { Spinner } from './Spinner';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { TriangleAlert, Usb } from 'lucide-react';
import { ERROR_MESSAGES } from '../constants/errorMessages';

export function ConnectButton() {
  const { requestDevice, isConnecting } = useDevices();
  const [isWebHIDSupported, setIsWebHIDSupported] = useState(true); // Assume supported during SSR
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setIsWebHIDSupported(typeof navigator !== 'undefined' && 'hid' in navigator);
  }, []);

  return (
    <div className="flex flex-col items-center gap-4 max-sm:w-full">
      <Button
        onClick={requestDevice}
        disabled={!isWebHIDSupported || isConnecting}
        size="lg"
        className="h-[52px] w-full rounded-full px-[26px] text-[15.5px] font-bold shadow-[0_6px_20px_-8px_color-mix(in_srgb,var(--primary)_70%,transparent)] hover:bg-primary hover:brightness-[1.06] [&_svg:not([class*='size-'])]:size-[17px]"
      >
        {isConnecting ? <Spinner size="md" className="text-primary-foreground" /> : <Usb aria-hidden="true" />}
        {isConnecting ? 'Connecting...' : 'Connect keyboard'}
      </Button>

      {mounted && !isWebHIDSupported && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription className="text-center">
            {ERROR_MESSAGES.WEBHID_NOT_AVAILABLE}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
