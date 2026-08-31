import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

// Lightweight toast system — surfaces node errors and confirmations app-wide.
// Dependency-free with inline styles so it can sit at the app root without
// extra CSS plumbing.

export type ToastKind = "error" | "success" | "info";

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastCtx {
  showToast: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx>({ showToast: () => {} });

export function useToast(): ToastCtx {
  return useContext(Ctx);
}

const viewport: CSSProperties = {
  position: "fixed",
  top: 16,
  right: 16,
  zIndex: 4000,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxWidth: 360,
  pointerEvents: "none",
};

const base: CSSProperties = {
  pointerEvents: "auto",
  padding: "11px 14px",
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.4,
  fontWeight: 600,
  boxShadow: "0 6px 24px rgba(0,0,0,0.30)",
  cursor: "pointer",
  animation: "mc-fade-in 0.18s ease",
};

const kindStyle: Record<ToastKind, CSSProperties> = {
  error: { background: "#ff5d6c", color: "#fff" },
  success: { background: "#43d17a", color: "#06250f" },
  info: { background: "#6c8cff", color: "#fff" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, kind: ToastKind = "error") => {
      if (!message) return;
      const id = ++idRef.current;
      setToasts((cur) => [...cur, { id, message, kind }]);
      setTimeout(() => remove(id), kind === "error" ? 7000 : 4000);
    },
    [remove],
  );

  return (
    <Ctx.Provider value={{ showToast }}>
      {children}
      <div style={viewport} aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            data-testid="toast"
            data-kind={t.kind}
            style={{ ...base, ...kindStyle[t.kind] }}
            onClick={() => remove(t.id)}
            title="Dismiss"
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
