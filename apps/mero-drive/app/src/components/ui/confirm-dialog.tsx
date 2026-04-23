// Dedicated confirm dialog for destructive actions. Replaces
// window.confirm() which (a) can't be styled, (b) is blocking (so
// can't show async submit state), and (c) is suppressed in some
// embedded browsers.
//
// Imperative API via useConfirm(): call `confirm({...})` and
// await a boolean. The dialog renders via ConfirmProvider that
// must be mounted near the app root.
//
// Keyboard behaviour: we intentionally do NOT handle Enter at the
// dialog level. Enter follows native button semantics — whichever
// button has focus (Cancel or the primary action) is "clicked" by
// Enter. On open we auto-focus the primary button so one-tap Enter
// confirms, but tabbing to Cancel and pressing Enter correctly
// cancels. A previous iteration caught Enter at the backdrop
// keydown handler, which bubbled from Cancel-with-focus and
// confirmed destructive actions by accident — that's been removed.
// Escape is still handled at the dialog level as a standard cancel.

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** When true, confirm button uses the destructive variant. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmCtx = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // If a dialog is already showing, resolve its promise as
      // false (treat it as an implicit cancel) before installing
      // the new one. Without this, calling confirm() twice in
      // quick succession would overwrite resolveRef and orphan the
      // first caller's await forever. Rare in practice but
      // deterministically broken when it happens.
      if (resolveRef.current) {
        resolveRef.current(false);
      }
      resolveRef.current = resolve;
      setOpts(next);
    });
  }, []);

  const close = useCallback((value: boolean) => {
    // Ensure we never leak promises if the provider unmounts
    // mid-dialog: resolve whatever caller is waiting before we
    // clear state.
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOpts(null);
    setSubmitting(false);
  }, []);

  const safeClose = () => {
    if (!submitting) close(false);
  };

  // Auto-focus the primary button on open so Enter activates it
  // via native button semantics (no custom keyboard handler
  // needed).
  useEffect(() => {
    if (opts) confirmButtonRef.current?.focus();
  }, [opts]);

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={safeClose}
          onKeyDown={(e) => {
            // Only Escape is handled at the dialog level. Enter is
            // intentionally NOT caught here — it follows native
            // button semantics on whichever button has focus.
            if (e.key === 'Escape') safeClose();
          }}
        >
          <div
            className="w-96 rounded-lg border border-border bg-card p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="confirm-title"
              className="mb-2 text-base font-semibold"
            >
              {opts.title}
            </h2>
            {opts.body && (
              <div className="text-sm text-muted-foreground">{opts.body}</div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={safeClose}
                disabled={submitting}
              >
                {opts.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                ref={confirmButtonRef}
                variant={opts.destructive ? 'destructive' : 'default'}
                size="sm"
                onClick={() => {
                  setSubmitting(true);
                  close(true);
                }}
                disabled={submitting}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) {
    throw new Error('useConfirm requires <ConfirmProvider> in the tree');
  }
  return ctx;
}
