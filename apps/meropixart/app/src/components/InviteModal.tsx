import { useEffect, useRef, useState } from "react";
import { adminPost } from "../api/rpc";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { encodeInvitationObject } from "../utils/invitation";
import { truncateMiddle } from "../utils/format";
import { getStoredTeamName } from "../utils/teamName";
import styles from "./InviteModal.module.css";

interface Props {
  teamId: string;
  onClose: () => void;
}

export default function InviteModal({ teamId, onClose }: Props) {
  const { showToast } = useToast();
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
      const data = await adminPost<Record<string, unknown>>(`/namespaces/${teamId}/invite`, {});
      if (data) {
        // Embed the team name so the joiner doesn't render a raw ID (see teamName.ts).
        const teamName = getStoredTeamName(teamId);
        const payload = teamName ? { ...data, __teamName: teamName } : data;
        setInvitation(encodeInvitationObject(payload));
      }
    } catch (err) {
      const msg = extractErrorMessage(err, "Failed to generate invitation. Check node connection.");
      setError(msg);
      showToast(msg);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!invitation || copying) return;
    await navigator.clipboard.writeText(invitation);
    showToast("Invitation copied to clipboard.", "success");
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
          Generate an invitation token and share it with your teammate.
          They paste it into their node to join this team.
        </p>

        {invitation ? (
          copying ? (
            <div className={styles.tokenBox} data-testid="invite-copying">
              <span className={styles.spinner} aria-hidden="true" />
              <span className={styles.copiedMsg}>Copied! Resetting invitation…</span>
            </div>
          ) : (
            <div className={styles.tokenBox}>
              <code className={styles.token} data-testid="invite-token" title={invitation}>
                {truncateMiddle(invitation, 22, 12)}
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
