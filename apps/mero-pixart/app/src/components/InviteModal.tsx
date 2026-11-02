import { useEffect, useRef, useState } from "react";
import { messageOf } from "../api/pixart";
import { useSignedIn } from "../api/sessionContext";
import { inviteLink, inviteToken } from "../api/teams";
import { useToast } from "../contexts/ToastContext";
import { truncateMiddle } from "../utils/format";
import styles from "./InviteModal.module.css";

interface Props {
  teamId: string;
  onClose: () => void;
}

export default function InviteModal({ teamId, onClose }: Props) {
  const { showToast } = useToast();
  const { client, passkey, after } = useSignedIn();
  const [invitation, setInvitation] = useState("");
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
      // An org invite, approved with this account's passkey. The link is all
      // there is to share: opening it (and signing in) joins the team.
      const token = await inviteToken(client, teamId, passkey());
      setInvitation(inviteLink(token));
    } catch (err) {
      const msg = `Failed to generate invitation: ${messageOf(err)}`;
      setError(msg);
      showToast(msg);
    } finally {
      setLoading(false);
      after();
    }
  }

  async function copy() {
    if (!invitation || copying) return;
    await navigator.clipboard.writeText(invitation);
    showToast("Invitation link copied to clipboard.", "success");
    // Brief loader, then reset to the "generate" state so each share is fresh.
    setCopying(true);
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => {
      setCopying(false);
      setInvitation("");
    }, 5000);
  }

  return (
    <div className="mp-overlay" onClick={onClose} data-testid="invite-modal-overlay">
      <div
        className={`mp-modal ${styles.modal}`}
        onClick={(e) => e.stopPropagation()}
        data-testid="invite-modal"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Invite to team</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        <p className={styles.desc}>
          Generate an invitation link and share it with your teammate. Opening it
          and signing in with a passkey joins this team. Each link works once.
        </p>

        {invitation ? (
          copying ? (
            <div className={styles.tokenBox} data-testid="invite-copying">
              <span className={styles.spinner} aria-hidden="true" />
              <span className={styles.copiedMsg}>Copied! Resetting invitation…</span>
            </div>
          ) : (
            <div className={styles.tokenBox}>
              <code
                className={styles.token}
                data-testid="invite-token"
                title={invitation}
              >
                {truncateMiddle(invitation, 28, 10)}
              </code>
              <button className="mp-btn" onClick={copy} data-testid="copy-invite">
                Copy
              </button>
            </div>
          )
        ) : (
          <button
            className="mp-btn mp-btn--primary"
            onClick={generate}
            disabled={loading}
            data-testid="generate-invite"
          >
            {loading ? "Generating…" : "Generate invitation"}
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  );
}
