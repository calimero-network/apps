// Dedicated confirm dialog for destructive actions. Replaces
// window.confirm() which (a) can't be styled, (b) is blocking (so
// can't show async submit state), and (c) is suppressed in some
// embedded browsers.
//
// Imperative API via useConfirm(): call `confirm({...})` and
// await a boolean. The dialog renders via ConfirmProvider that
// must be mounted near the app root.
//
// Keyboard behaviour:
// - Escape at the dialog level → cancel.
// - Enter is NOT handled by the dialog; whichever button has focus
//   is "clicked" via native button semantics. The primary (confirm)
//   button autofocuses on open, so the common "open → Enter →
//   confirm" flow works with one keystroke, but Tab-to-Cancel-then-
//   Enter correctly cancels.
// - Tab / Shift-Tab cycle within the dialog (minimal focus trap).

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
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      // If a dialog is already showing, resolve its promise as
      // false (treat it as an implicit cancel) before installing
      // the new one. Without this, calling confirm() twice in
      // quick succession would overwrite resolveRef and orphan the
      // first caller's await forever.
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
  }, []);

  // Auto-focus the primary button on open so Enter activates it
  // via native button semantics. Tab/Shift-Tab then cycles between
  // Cancel and Confirm.
  useEffect(() => {
    if (opts) confirmButtonRef.current?.focus();
  }, [opts]);

  // Minimal focus trap: Tab at the last focusable wraps to the
  // first; Shift-Tab at the first wraps to the last. Keeps
  // keyboard focus from leaking to the page behind the modal.
  const onPanelKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [],
  );

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {opts && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => close(false)}
          onKeyDown={(e) => {
            // Only Escape at the dialog level. Enter follows native
            // button semantics on whichever button has focus.
            if (e.key === 'Escape') close(false);
          }}
        >
          <div
            ref={panelRef}
            tabIndex={-1}
            className="w-96 rounded-lg border border-border bg-card p-5 shadow-xl outline-none"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onPanelKeyDown}
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
                onClick={() => close(false)}
              >
                {opts.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                ref={confirmButtonRef}
                variant={opts.destructive ? 'destructive' : 'default'}
                size="sm"
                onClick={() => close(true)}
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
