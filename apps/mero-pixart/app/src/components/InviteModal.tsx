import { useEffect, useRef, useState } from "react";

import { inviteLink } from "../api/teams";
import { useSignedIn } from "../sessionContext";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { truncateMiddle } from "../utils/format";
import styles from "./InviteModal.module.css";

interface Props {
  teamId: string;
  /** The project the link opens after joining; the team's project list without it. */
  projectId?: string;
  onClose?: () => void;
}

/**
 * Makes an invitation into the team (an org invite, role `member`, approved
 * with the inviter's passkey) and the link that redeems it. v1 signed a
 * namespace invitation and packed it into a deflate+base58 link.
 */
export function InvitePanel({ teamId, projectId }: { teamId: string; projectId?: string }) {
  const { showToast } = useToast();
  const { client, passkey, after } = useSignedIn();
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetRef.current) clearTimeout(resetRef.current);
  }, []);

  async function generate() {
    setError("");
    setLoading(true);
    try {
      const token = await client.invite(teamId, "member", passkey());
      setLink(inviteLink(token, projectId));
    } catch (err) {
      const msg = extractErrorMessage(err, "Could not make an invitation.");
      setError(msg);
      showToast(msg);
    } finally {
      setLoading(false);
      after();
    }
  }

  async function copy() {
    if (!link || copying) return;
    await navigator.clipboard.writeText(link);
    showToast("Invitation link copied to clipboard.", "success");
    // Brief loader, then reset to the "generate" state so each share is fresh.
    setCopying(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopying(false);
      setLink("");
    }, 5000);
  }

  return (
    <>
      {link ? (
        copying ? (
          <div className={styles.tokenBox} data-testid="invite-copying">
            <span className={styles.spinner} aria-hidden="true" />
            <span className={styles.copiedMsg}>Copied! Resetting invitation…</span>
          </div>
        ) : (
          <div className={styles.tokenBox}>
            <code className={styles.token} data-testid="invite-token" title={link}>
              {truncateMiddle(link, 28, 10)}
            </code>
            <button className="mp-btn" onClick={copy} data-testid="copy-invite">Copy</button>
          </div>
        )
      ) : (
        <button className="mp-btn mp-btn--primary" onClick={generate} disabled={loading} data-testid="generate-invite">
          {loading ? "Waiting for your passkey…" : "Generate invitation"}
        </button>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </>
  );
}

export default function InviteModal({ teamId, projectId, onClose }: Props) {
  return (
    <div className="mp-overlay" onClick={onClose} data-testid="invite-modal-overlay">
      <div className={`mp-modal ${styles.modal}`} onClick={(e) => e.stopPropagation()} data-testid="invite-modal">
        <div className={styles.header}>
          <h2 className={styles.title}>Invite to team</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>
        <p className={styles.desc}>
          Generate an invitation link (approved with your passkey) and share it. Whoever opens it
          signs in, or creates an account, and joins this team{projectId ? ", landing in this project" : ""}.
          Each link is good for one person.
        </p>
        <InvitePanel teamId={teamId} projectId={projectId} />
      </div>
    </div>
  );
}
