import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { shareableInvitation } from "../lib/inviteLink";
import { useToast } from "../contexts/ToastContext";
import { useDialogOpen } from "../hooks/useDialogOpen";
import styles from "./InviteModal.module.css";

/**
 * An invitation, as a modal you copy and dismiss.
 *
 * This replaces an inline panel that expanded in place below the team list.
 * Three problems with that shape, all of which this fixes:
 *
 *   * it pushed the list down, so the row you clicked moved out from under the
 *     pointer at the moment the invite appeared;
 *   * it stayed open until something else replaced it, which made a stale
 *     invitation for one team look current while you were reading another;
 *   * it offered link / desktop link / raw code at equal weight, so the choice
 *     was yours to make every single time, and the answer is the link ~always.
 *
 * So: the link is the primary action, copying it closes the dialog, and the
 * other two forms stay behind a disclosure for the cases that genuinely need
 * them. Matches the invite shape in mero-design, mero-pixart and mero-calendar.
 */
export default function InviteModal({
  open,
  code,
  scope,
  hint,
  onClose,
}: {
  open: boolean;
  code: string;
  /** What the invitation grants — "Whole team · Foo" or "Opens Bar". */
  scope: string;
  hint?: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const { showToast } = useToast();
  const [showRaw, setShowRaw] = useState(false);
  // Guarded, because this component is mounted for the whole page life now —
  // `open` drives it, not a conditional render — so it renders many times with
  // no invitation minted yet. `shareableInvitation` THROWS on an empty code,
  // which took the whole page down on load until this returned null instead.
  const share = useMemo(
    () => (code.trim() ? shareableInvitation(code) : null),
    [code],
  );

  useDialogOpen(dialogRef, open && !!share);

  const copyAndClose = useCallback(async () => {
    // Defined above the early return, so `share` is nullable here even though
    // the button that calls it only exists once it is not.
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.link);
      showToast("Invitation link copied.", "success");
      onClose();
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded webviews. Keep the dialog OPEN so the text is still there to
      // select by hand — closing it would take away the only copy left.
      showToast(
        "Could not reach the clipboard — select the link and copy it.",
        "error",
      );
      setShowRaw(true);
    }
  }, [share, showToast, onClose]);

  const copyQuietly = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        showToast(`${label} copied.`, "success");
      } catch {
        showToast(
          "Could not reach the clipboard — select it and copy.",
          "error",
        );
      }
    },
    [showToast],
  );

  // After the hooks, never before: an early return above them would change the
  // hook order between renders.
  if (!share) return null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      onClose={onClose}
      onClick={(e) => {
        // Backdrop click closes. The dialog element itself fills only its box,
        // so a click whose target IS the dialog landed on the backdrop.
        if (e.target === dialogRef.current) onClose();
      }}
      data-testid="invite-modal"
    >
      <div className={styles.body}>
        <header className={styles.head}>
          <h2 className={styles.title}>Invitation ready</h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
            data-testid="invite-modal-close"
          >
            ✕
          </button>
        </header>

        <p className={styles.scope} data-testid="invite-scope">
          {scope}
        </p>

        {/* One line by default; `showRaw` is also the "clipboard failed" state,
            where the characters have to be selectable. */}
        <code
          className={styles.link}
          title={share.link}
          data-full={showRaw ? "true" : "false"}
          data-testid="invite-link"
        >
          {share.link}
        </code>

        <button
          type="button"
          className={styles.primary}
          onClick={copyAndClose}
          data-testid="invite-copy"
        >
          Copy link
        </button>

        {hint && <p className={styles.hint}>{hint}</p>}

        <button
          type="button"
          className={styles.disclosure}
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
          data-testid="invite-more"
        >
          {showRaw ? "Fewer options" : "Other ways to send this"}
        </button>

        {showRaw && (
          <div className={styles.more}>
            <label className={styles.moreLabel}>
              Desktop link
              <span className={styles.moreNote}>
                Hands the invitation straight to an installed desktop app. Does
                not survive being pasted into most chat windows.
              </span>
            </label>
            <div className={styles.moreRow}>
              <code className={styles.moreValue}>{share.deepLink}</code>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void copyQuietly(share.deepLink, "Desktop link")}
                data-testid="invite-copy-deep"
              >
                Copy
              </button>
            </div>

            <label className={styles.moreLabel}>
              Raw code
              <span className={styles.moreNote}>
                The cross-app format mero-chat and mero-blocks also read.
              </span>
            </label>
            <div className={styles.moreRow}>
              <code className={styles.moreValue}>{share.code}</code>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void copyQuietly(share.code, "Code")}
                data-testid="invite-copy-code"
              >
                Copy
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
