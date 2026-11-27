import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui";

/**
 * "Delete <workspace>?": a dialog that spells out what goes, and asks for the
 * workspace's name typed back before the red button works. Closes on Esc, ✕,
 * Cancel or a click outside, but not while the delete is running.
 */
export function DeleteWorkspaceDialog({
  name,
  open,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  name: string;
  open: boolean;
  busy: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const pressedOutside = useRef(false);
  const [typed, setTyped] = useState("");
  const wanted = name.trim() || "delete";

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setTyped("");
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
    } else if (!open && el.open) {
      if (typeof el.close === "function") el.close();
      else el.removeAttribute("open");
    }
  }, [open]);

  const cancel = () => {
    if (!busy) onCancel();
  };
  const matches = typed.trim() === wanted;

  return (
    <dialog
      ref={ref}
      className="dialog confirm-dialog"
      aria-labelledby="delete-ws-title"
      data-testid="delete-workspace-dialog"
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      onMouseDown={(e) => (pressedOutside.current = e.target === e.currentTarget)}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) cancel();
        pressedOutside.current = false;
      }}
    >
      {open && (
        <form
          className="dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches && !busy) onConfirm();
          }}
        >
          <div className="confirm-head">
            <span className="confirm-icon" aria-hidden="true">
              <Icon name="trash" size={18} />
            </span>
            <button type="button" className="icon-btn" aria-label="Close" onClick={cancel} disabled={busy}>
              <Icon name="x" />
            </button>
          </div>
          <h2 id="delete-ws-title">Delete {name || "this workspace"}?</h2>
          <p className="empty">
            Every meeting, recording, transcript and action item in it is deleted for everyone in the workspace. This
            can&apos;t be undone.
          </p>
          <label className="confirm-label">
            <span>
              Type <b>{wanted}</b> to confirm
            </span>
            <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} disabled={busy} aria-label={`Type ${wanted} to confirm`} />
          </label>
          {error && <p className="err small">{error}</p>}
          <div className="confirm-actions">
            <button type="button" className="btn ghost" onClick={cancel} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn danger" disabled={!matches || busy}>
              {busy ? "Deleting…" : "Delete workspace"}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
