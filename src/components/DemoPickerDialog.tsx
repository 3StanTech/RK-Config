import { forwardRef } from 'react';
import { X } from 'lucide-react';
import { KeyboardSelector } from './KeyboardSelector';

interface DemoPickerDialogProps {
  keyboards: Array<{ pid: string; name: string }>;
  onSelect: (pid: string) => void;
}

/**
 * Native modal dialog for picking a demo keyboard. The opener calls showModal();
 * Esc and the close button dismiss it, and the browser returns focus to the opener.
 */
export const DemoPickerDialog = forwardRef<HTMLDialogElement, DemoPickerDialogProps>(
  function DemoPickerDialog({ keyboards, onSelect }, ref) {
    const close = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.closest('dialog')?.close();

    return (
      <dialog
        ref={ref}
        aria-labelledby="demo-title"
        className="demo-dialog m-auto w-full max-w-[min(560px,calc(100vw-32px))] rounded-[calc(var(--radius)+6px)] border border-border bg-popover p-0 text-popover-foreground shadow-lg"
      >
        <div className="grid gap-3.5 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 id="demo-title" className="text-[19px] font-extrabold">Pick a keyboard to explore</h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground">
            Demo mode lets you explore the interface without a keyboard. You can stage edits and press Apply, but Apply
            is only simulated: nothing is written to hardware or saved in this browser, and a demo apply is never evidence
            that a model works.
          </p>
          <KeyboardSelector keyboards={keyboards} onSelect={onSelect} showRandom={true} />
        </div>
      </dialog>
    );
  }
);
