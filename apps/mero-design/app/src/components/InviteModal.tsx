import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createTeamInvitation } from "../api/rpc";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { inviteLink } from "../utils/inviteLink";
import { truncateMiddle } from "../utils/format";
import { InviteArt } from "./Artwork";
import styles from "./InviteModal.module.css";

interface Props {
  teamId: string;
  /** The team's name, for the title. */
  teamName: string;
  onClose: () => void;
}

/**
 * Invite people to the team: the top bar's Invite button opens this.
 *
 * Minting a link is an org invite, which the node asks your passkey to
 * approve, so it starts from a click ("Create link") rather than on open: a
 * browser shows a passkey prompt only for a user gesture. Each link is one
 * invitation; "New link" mints another for the next person.
 *
 * Rendered into `document.body`: the top bar that opens it is frosted glass,
 * and `backdrop-filter` makes it the containing block for a fixed scrim.
 */
export default function InviteModal({ teamId, teamName, onClose }: Props) {
  // The link names the team, so someone already in it is not offered Join.
  const invitationLink = (token: string) => inviteLink(token, window.location, undefined, teamId);
  const { showToast } = useToast();
  const [invitation, setInvitation] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  const generate = useCallback(async () => {
    setError("");
    setCopied(false);
    setInvitation("");
    setLoading(true);
    try {
      const token = await createTeamInvitation(teamId);
      if (token) setInvitation(token);
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to create the invitation."));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  async function copy() {
    if (!invitation) return;
    // Share the link, not the bare token: it opens this app, which asks them
    // to sign in and join.
    try {
      await navigator.clipboard.writeText(invitationLink(invitation));
    } catch {
      // No clipboard (insecure context, some webviews): the link is selectable.
      showToast("Could not reach the clipboard — select the link and copy it.");
      return;
    }
    setCopied(true);
    showToast("Invitation link copied to clipboard.", "success");
  }

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="invite-modal-overlay">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        data-testid="invite-modal"
      >
        <div className={styles.header}>
          <h2 id="invite-title" className={styles.title}>Invite to {teamName}</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className={styles.art}><InviteArt /></div>

        <p className={styles.desc}>
          Send this invitation link to a teammate. Opening it asks them to sign in
          with a passkey and join. They will see every board in the team.
        </p>

        {invitation ? (
          <div className={styles.tokenBox}>
            <code
              className={styles.token}
              data-testid="invite-token"
              title={invitationLink(invitation)}
            >
              {truncateMiddle(invitationLink(invitation), 30, 12)}
            </code>
          </div>
        ) : (
          <div className={styles.tokenBox} aria-busy={loading}>
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.muted}>{loading ? "Approve with your passkey…" : "No link yet"}</span>
          </div>
        )}

        {invitation && (
          <p className={styles.note} data-testid="invite-single-use">
            Single use: the link lets one person join. Make a new link for each person.
          </p>
        )}

        {error && <p className={styles.error} role="alert">{error}</p>}

        <div className={styles.actions}>
          <button
            className={styles.secondaryBtn}
            onClick={() => void generate()}
            disabled={loading}
            data-testid="generate-invite"
            title="Each link is one invitation; make another for the next person"
          >
            {invitation ? "New link" : "Create link"}
          </button>
          <button
            className={styles.primaryBtn}
            onClick={() => void copy()}
            disabled={!invitation}
            data-testid="copy-invite"
          >
            {copied ? "Copied ✓" : "Copy link"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
