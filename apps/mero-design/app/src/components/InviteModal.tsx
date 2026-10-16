import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createNamespaceInvitation } from "../api/rpc";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { encodeInvitationObject, invitationLink } from "../utils/invitation";
import { truncateMiddle } from "../utils/format";
import { getStoredTeamName } from "../utils/teamName";
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
 * The link is minted the moment the dialog opens, so inviting is one click to
 * copy, not "Invitations tab → Generate → Copy". Each copy hands out one
 * invitation; "New link" mints another for the next person.
 *
 * Rendered into `document.body`: the top bar that opens it is frosted glass,
 * and `backdrop-filter` makes it the containing block for a fixed scrim.
 */
export default function InviteModal({ teamId, teamName, onClose }: Props) {
  const { showToast } = useToast();
  const [invitation, setInvitation] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  // Strict mode mounts twice; one open mints one invitation.
  const minted = useRef(false);

  const generate = useCallback(async () => {
    setError("");
    setCopied(false);
    setInvitation("");
    setLoading(true);
    try {
      const data = await createNamespaceInvitation(teamId);
      if (data) {
        // Embed the team name so the joiner doesn't render a raw ID (see teamName.ts).
        const storedName = getStoredTeamName(teamId);
        const payload = storedName ? { ...data, __teamName: storedName } : data;
        setInvitation(encodeInvitationObject(payload));
      }
    } catch (err) {
      setError(extractErrorMessage(err, "Failed to generate invitation. Check node connection."));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    if (minted.current) return;
    minted.current = true;
    void generate();
  }, [generate]);

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
    // Share the link, not the bare token: it opens the desktop app where
    // installed and the published web build otherwise.
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
          Send this invitation link to a teammate. Opening it launches the desktop
          app where installed, and the web build otherwise, and asks them to join.
          They will see every board in the team.
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
            <span className={styles.muted}>{loading ? "Creating a link…" : "No link yet"}</span>
          </div>
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
            New link
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
