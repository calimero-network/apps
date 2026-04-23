// Dedicated confirm dialog for destructive actions. Replaces
// window.confirm() which (a) can't be styled, (b) is blocking (so
// can't show async submit state), and (c) is suppressed in some
// embedded browsers.
//
// Imperative API via useConfirm(): call `confirm({...})` and
// await a boolean. The dialog renders on a portal managed by the
// ConfirmProvider that must be mounted near the app root.
//
// Patterns carried from NamespaceCreateDialog / NewFolderDialog:
// - safeClose gates dismissal during an in-flight submit
// - Enter = primary action, Escape = cancel

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
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

  const confirm = useCallback<ConfirmFn>((next) => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setOpts(next);
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      // Ensure we never leak promises if the provider unmounts
      // mid-dialog: resolve whatever caller is waiting before we
      // clear state.
      resolveRef.current?.(value);
      resolveRef.current = null;
      setOpts(null);
      setSubmitting(false);
    },
    [],
  );

  const safeClose = () => {
    if (!submitting) close(false);
  };

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
            if (e.key === 'Escape') safeClose();
            if (e.key === 'Enter' && !submitting) {
              setSubmitting(true);
              close(true);
            }
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
