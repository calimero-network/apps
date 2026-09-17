import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./ToastContext.module.css";

/**
 * Transient outcome messages.
 *
 * Replaces the per-page `setDone(...)` string, which rendered as a permanent
 * note wedged into the page body — "Invite ready for “test”." sat above the
 * stream list until the next action cleared it, pushing the layout down and
 * reading like part of the page rather than something that just happened.
 *
 * A toast says it once, near the edge, and leaves. Errors stay longer than
 * successes because they are read rather than glanced at, and both can be
 * dismissed.
 */

export type ToastKind = "success" | "error";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastApi {
  showToast: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<ToastApi | null>(null);

const DISMISS_MS: Record<ToastKind, number> = {
  success: 3200,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  // Timers are cleared on unmount: a pending dismiss firing after the provider
  // has gone calls setState on an unmounted tree.
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      timers.current.clear();
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = "success") => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((prev) => [...prev, { id, message, kind }]);
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        dismiss(id);
      }, DISMISS_MS[kind]);
      timers.current.add(timer);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {/* aria-live so a screen reader announces the outcome; `polite` because
          none of these interrupt what the user is doing. */}
      <div
        className={styles.stack}
        role="status"
        aria-live="polite"
        data-testid="toast-stack"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.toast} ${t.kind === "error" ? styles.error : styles.success}`}
            onClick={() => dismiss(t.id)}
            data-testid={`toast-${t.kind}`}
            title="Dismiss"
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/**
 * Never throws when there is no provider. A toast is a nicety, and a component
 * rendered in a test or in isolation should not crash for want of one.
 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx);
  return ctx ?? { showToast: () => {} };
}
