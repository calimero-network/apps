import { useEffect, useRef } from "react";
import styles from "./ConfirmDialog.module.css";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** Paints the confirm button red: the action throws work away. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An in-page confirm, used instead of `window.confirm`.
 *
 * The desktop shell's webview (wry/WKWebView) implements no JavaScript confirm
 * panel, so `window.confirm` there returns `false` at once without showing
 * anything — Open (.merodesign) looked dead because its confirm was "cancelled"
 * before the user ever saw it.
 *
 * Keys are caught in the capture phase while it is open: the board underneath
 * listens on `window`, and Backspace or an arrow key reaching it would edit the
 * selection behind the dialog.
 */
export default function ConfirmDialog({ title, message, confirmLabel, destructive, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      e.stopImmediatePropagation();
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      else if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      else if (e.key !== "Tab") e.preventDefault();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, onConfirm]);

  return (
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className={styles.modal} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message" data-testid="confirm-dialog">
        <h2 id="confirm-title" className={styles.title}>{title}</h2>
        <p id="confirm-message" className={styles.message}>{message}</p>
        <div className={styles.actions}>
          <button className={styles.cancel} onClick={onCancel} data-testid="confirm-cancel">Cancel</button>
          <button
            ref={confirmRef}
            className={`${styles.confirm} ${destructive ? styles.destructive : ""}`}
            onClick={onConfirm}
            data-testid="confirm-ok"
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
