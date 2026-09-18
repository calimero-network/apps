import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { shareableInvitation } from '../lib/inviteLink';
import { useDialogOpen } from '../hooks/useDialogOpen';
import styles from './InviteModal.module.css';

/**
 * An invitation, as a modal you copy and dismiss.
 *
 * The link is the primary action, copying it closes the dialog, and the other
 * two forms (the desktop deep link, the raw cross-app code) stay behind a
 * disclosure for the cases that genuinely need them. Matches the invite shape
 * in mero-stream, mero-meet, mero-design and mero-calendar.
 *
 * ⚠️ `scope` is not decoration in THIS app. An invitation to a vault grants
 * membership of the whole team, because vault access is inherited — so the
 * person clicking Copy has to be able to read what they are about to hand out.
 * A password manager that understates a grant is worse than one with no sharing
 * at all.
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
  /** What the invitation grants — "Whole team · Home" or "Opens Bank logins". */
  scope: string;
  hint?: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // An inline note rather than a toast layer. mero-ui's ToastProvider was the
  // app's only remaining use of the library, and mounting a whole provider —
  // plus its stylesheet, plus its surface colours — to say "copied" was not
  // worth it. The message belongs next to the thing that was copied anyway.
  const [note, setNote] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  // Guarded, because this component is mounted for the whole page life —
  // `open` drives it, not a conditional render — so it renders many times with
  // no invitation minted yet. `shareableInvitation` THROWS on an empty code.
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
      setNote('Invitation link copied.');
      onClose();
    } catch {
      // Clipboard access is denied outside a secure context and in some
      // embedded webviews. Keep the dialog OPEN so the text is still there to
      // select by hand — closing it would take away the only copy left.
      setNote('Could not reach the clipboard — select the link and copy it.');
      setShowRaw(true);
    }
  }, [share, onClose]);

  const copyQuietly = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setNote(`${label} copied.`);
      } catch {
        setNote('Could not reach the clipboard — select it and copy.');
      }
    },
    [],
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
          data-full={showRaw ? 'true' : 'false'}
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

        {note && (
          <p className={styles.hint} data-testid="invite-note">
            {note}
          </p>
        )}

        {hint && <p className={styles.hint}>{hint}</p>}

        <button
          type="button"
          className={styles.disclosure}
          onClick={() => setShowRaw((v) => !v)}
          aria-expanded={showRaw}
          data-testid="invite-more"
        >
          {showRaw ? 'Fewer options' : 'Other ways to send this'}
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
                onClick={() => void copyQuietly(share.deepLink, 'Desktop link')}
                data-testid="invite-copy-deep"
              >
                Copy
              </button>
            </div>

            <label className={styles.moreLabel}>
              Raw code
              <span className={styles.moreNote}>
                The cross-app format mero-chat and mero-stream also read.
              </span>
            </label>
            <div className={styles.moreRow}>
              <code className={styles.moreValue}>{share.code}</code>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void copyQuietly(share.code, 'Code')}
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
