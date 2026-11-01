import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CircleX } from 'lucide-react';
import { Spinner } from './Spinner';

/** Explicit resend when nothing is pending (H3). Shown only when the caller says sending is safe. */
export interface ResendOption {
  /** Button label, e.g. "Resend lighting". */
  label: string;
  /** Main line, e.g. "The settings shown match what this browser last sent." */
  lead: string;
  /** Second line: no-readback explanation and exact report count. */
  detail: string;
}

/** Confirmation required before every transmission from this bar (H2). */
export interface ConfirmOption {
  title: string;
  body: ReactNode;
  confirmLabel: string;
}

interface PendingChangesProps {
  /** Number of pending edits in this pane. */
  count: number;
  /** e.g. "2 key changes" or "1 setting · 61 key colors". */
  summary: string;
  /** What Apply sends, e.g. "the full keymap (9 reports)". */
  sends: string;
  /** e.g. "Your 3 pending lighting changes stay pending." */
  otherAreaNote?: string;
  /** Extra explanation, e.g. why some edits can't be sent yet. */
  note?: string;
  /** This pane's transfer is running. */
  busy: boolean;
  /** Any transfer is running, or the keyboard can't be written. */
  locked: boolean;
  /** Apply is possible beyond pending edits (e.g. retry after a failed transfer). */
  failed: boolean;
  /** Apply is not possible for the pending edits; explains why. */
  blockedReason?: string | null;
  isDemo: boolean;
  areaName: 'key' | 'lighting';
  /** Offer an explicit resend when nothing is pending and nothing failed. */
  resend?: ResendOption | null;
  /** Ask before every send (Apply or Retry). Cancel sends nothing. */
  confirm?: ConfirmOption | null;
  /** Called when the confirmation is cancelled (button or Escape). */
  onConfirmCancel?: () => void;
  onApply: () => void;
  onDiscard: () => void;
}

/**
 * Modal confirmation: initial focus on Cancel, Tab stays inside, Escape cancels,
 * and focus returns to the opening button on close.
 */
function ConfirmDialog({
  option,
  onCancel,
  onConfirm,
}: {
  option: ConfirmOption;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Focus management and key handling only; nothing is sent from an effect.
  useEffect(() => {
    cancelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancelRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = dialogRef.current?.contains(document.activeElement);
      if (!inside) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Portal to <body> so the sticky bar's stacking context can't place the overlay under other content.
  return createPortal(
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div
        ref={dialogRef}
        className="max-w-lg w-full"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
      <Card className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        <CardContent className="space-y-3">
          <h3 id={titleId} className="text-lg font-semibold text-card-foreground">{option.title}</h3>
          <div id={bodyId} className="text-sm text-card-foreground space-y-2">{option.body}</div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button ref={cancelRef} variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="sm" className="flex-1 sm:flex-none" onClick={onConfirm}>
              {option.confirmLabel}
            </Button>
          </div>
        </CardContent>
      </Card>
      </div>
    </div>,
    document.body
  );
}

/** Sticky per-pane bar: pending count, what Apply sends, Discard and Apply. */
export function PendingChanges({
  count,
  summary,
  sends,
  otherAreaNote,
  note,
  busy,
  locked,
  failed,
  blockedReason,
  isDemo,
  areaName,
  resend,
  confirm,
  onConfirmCancel,
  onApply,
  onDiscard,
}: PendingChangesProps) {
  // Pending edits and failure retry take precedence over the no-diff resend.
  const activeResend = count === 0 && !failed ? resend ?? null : null;
  const canApply = !locked && !blockedReason && (count > 0 || failed || !!activeResend);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const applyRef = useRef<HTMLButtonElement>(null);

  // Close the dialog safely if sending becomes impossible (lock, disconnect, no edits).
  if (confirmOpen && (!canApply || !confirm)) {
    setConfirmOpen(false);
  }

  const closeConfirm = () => {
    setConfirmOpen(false);
    applyRef.current?.focus();
  };

  const handleApplyClick = () => {
    if (!canApply) return;
    if (confirm) setConfirmOpen(true);
    else onApply();
  };

  const tone = busy
    ? 'border-primary'
    : failed
      ? 'border-destructive'
      : count > 0
        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
        : 'border-border';

  return (
    <div
      className={`sticky bottom-3 z-10 mt-6 rounded-xl border bg-card px-4 py-3 shadow-sm flex flex-wrap items-center justify-between gap-3 ${tone}`}
      role="region"
      aria-label={`Pending ${areaName} changes`}
    >
      <div className="min-w-0 flex-1 space-y-0.5" aria-live="polite">
        {busy ? (
          <div className="flex items-center gap-2">
            <Spinner size="sm" className="text-primary" />
            <div>
              <p className="text-sm font-semibold text-card-foreground">Applying to keyboard… keep it plugged in</p>
              <p className="text-xs text-muted-foreground">Sending {sends}. Editing is locked until it finishes.</p>
            </div>
          </div>
        ) : count > 0 ? (
          <>
            <p className="text-sm font-semibold text-card-foreground">
              <span className="mr-1.5 inline-flex min-w-5 h-5 items-center justify-center rounded-full bg-amber-600 px-1.5 text-xs text-white">
                {count}
              </span>
              {summary} not sent yet
            </p>
            <p className="text-xs text-muted-foreground">
              Apply sends {sends} only.{confirm ? ' You’ll be asked to confirm first.' : ''}{otherAreaNote ? ` ${otherAreaNote}` : ''}
            </p>
          </>
        ) : activeResend ? (
          <>
            <p className="text-sm text-muted-foreground">
              No pending {areaName} changes. {activeResend.lead}
              {otherAreaNote ? ` ${otherAreaNote}` : ''}
            </p>
            <p className="text-xs text-muted-foreground">{activeResend.detail}</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No pending {areaName} changes
            {failed
              ? ` — but the last ${areaName} transfer failed, so the keyboard may be partly updated. Retry Apply resends the last applied ${areaName} settings`
              : ''}.
            {otherAreaNote ? ` ${otherAreaNote}` : ''}
          </p>
        )}
        {!busy && (blockedReason || note) && (
          <p className="text-xs text-muted-foreground">{blockedReason || note}</p>
        )}
      </div>
      <div className="flex gap-2 w-full sm:w-auto">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 sm:flex-none"
          onClick={onDiscard}
          disabled={count === 0 || locked}
        >
          Discard
        </Button>
        <Button
          ref={applyRef}
          size="sm"
          variant={activeResend && !busy ? 'outline' : 'default'}
          className="flex-1 sm:flex-none"
          onClick={handleApplyClick}
          disabled={!canApply}
          aria-haspopup={confirm ? 'dialog' : undefined}
        >
          {busy && <Spinner size="sm" className={activeResend ? 'text-foreground' : 'text-primary-foreground'} />}
          {isDemo && <span>[DEMO]</span>}
          {failed ? 'Retry Apply' : activeResend ? activeResend.label : 'Apply to keyboard'}
        </Button>
      </div>
      {confirmOpen && confirm && canApply && (
        <ConfirmDialog
          option={confirm}
          onCancel={() => {
            closeConfirm();
            onConfirmCancel?.();
          }}
          onConfirm={() => {
            // Close first so a double click cannot send twice; the busy lock then disables Apply.
            setConfirmOpen(false);
            onApply();
          }}
        />
      )}
    </div>
  );
}

/** Pane-level alert for a failed or rejected apply. */
export function ApplyErrorAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <CircleX className="h-4 w-4" />
      <AlertDescription>
        <p className="font-semibold">Apply did not complete</p>
        <p>{message}</p>
      </AlertDescription>
    </Alert>
  );
}
