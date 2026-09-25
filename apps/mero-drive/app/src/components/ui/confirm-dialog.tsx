// Imperative confirm: `await confirm({...})` via useConfirm(); only the confirm button resolves true.
// Destructive confirms focus Cancel first so a stray Enter never deletes.

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

// A menu item unmounts with its menu, so return focus to the trigger that labels the menu.
function focusReturnTarget(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const triggerId = active
    ?.closest('[role="menu"]')
    ?.getAttribute('aria-labelledby');
  return (triggerId && document.getElementById(triggerId)) || active;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

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
      openerRef.current = focusReturnTarget();
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

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={opts !== null}
        onOpenChange={(open) => !open && close(false)}
      >
        {opts && (
          <DialogContent
            className="max-w-sm"
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (opts.destructive
                ? cancelButtonRef
                : confirmButtonRef
              ).current?.focus();
            }}
            // Radix returns focus to a Dialog.Trigger; an imperative confirm has none.
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              openerRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{opts.title}</DialogTitle>
              {opts.body && (
                <DialogDescription asChild>
                  <div>{opts.body}</div>
                </DialogDescription>
              )}
            </DialogHeader>
            <DialogFooter>
              <Button
                ref={cancelButtonRef}
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
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
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
