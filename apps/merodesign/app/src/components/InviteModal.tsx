import { useState } from "react";
import { adminPost } from "../api/rpc";
import styles from "./InviteModal.module.css";

interface Props {
  teamId: string;
  onClose: () => void;
}

export default function InviteModal({ teamId, onClose }: Props) {
  const [invitation, setInvitation] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    setError("");
    setLoading(true);
    try {
      const data = await adminPost<{ invitation?: string; data?: string }>(
        `/namespaces/${teamId}/invitations`,
        {},
      );
      setInvitation(data.invitation ?? (data.data as string) ?? "");
    } catch {
      setError("Failed to generate invitation. Check node connection.");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!invitation) return;
    await navigator.clipboard.writeText(invitation);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={styles.overlay} onClick={onClose} data-testid="invite-modal-overlay">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        data-testid="invite-modal"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Invite to team</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <p className={styles.desc}>
          Generate an invitation token and share it with your teammate.
          They paste it into their node to join this team.
        </p>

        {invitation ? (
          <div className={styles.tokenBox}>
            <code className={styles.token} data-testid="invite-token">{invitation}</code>
            <button className={styles.copyBtn} onClick={copy} data-testid="copy-invite">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            className={styles.generateBtn}
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
