import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';

/**
 * Toasts, in this app's palette.
 *
 * mero-ui ships a `ToastProvider`, but it paints each variant INLINE from its
 * own palette — an error arrived as white text on saturated red, which is hard
 * to read and belongs to a different product than the page behind it. There is
 * no style passthrough on the item and the variant is not in a class, so CSS
 * cannot reach it: a white toast and a red one are indistinguishable to a
 * selector. Hence this.
 *
 * ⚠️ THE API IS DELIBERATELY IDENTICAL — `useToast().show({ title, variant })`
 * — so the thirty call sites did not have to change, only the import.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  title: string;
  variant: ToastVariant;
}

interface ToastApi {
  show: (toast: { title: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const DURATION_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Timers are cleared on unmount so a pending dismissal cannot fire into a
  // gone tree.
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const show = useCallback<ToastApi['show']>(({ title, variant = 'info' }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, title, variant }]);
    timers.current.push(
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), DURATION_MS),
    );
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* `role="status"` and `aria-live` so a screen reader announces the
          message without the toast stealing focus. */}
      <div className="toast-viewport" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.variant}`}>
            <span className="toast-dot" aria-hidden />
            <span className="toast-text">{t.title}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
