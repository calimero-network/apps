import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { adminGet } from "../api/rpc";
import styles from "./SettingsModal.module.css";

type MemberRaw = { identity?: string; memberId?: string; id?: string };

interface Props {
  type: "team" | "project";
  id: string;
  name: string;
  onClose: () => void;
}

export default function SettingsModal({ type, id, name, onClose }: Props) {
  const { applicationId } = useMero();
  const [members, setMembers] = useState<string[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setLoadingMembers(true);
    adminGet<MemberRaw[] | { members?: MemberRaw[]; data?: MemberRaw[] }>(`/groups/${id}/members`)
      .then((raw) => {
        const arr: MemberRaw[] = Array.isArray(raw)
          ? raw
          : (raw as { members?: MemberRaw[] }).members ?? (raw as { data?: MemberRaw[] }).data ?? [];
        setMembers(arr.map((m) => m.identity ?? m.memberId ?? m.id ?? "?"));
      })
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [id]);

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{name} — Settings</h2>
          <button className={styles.close} onClick={onClose}>✕</button>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>{type === "project" ? "Context ID" : "Group ID"}</span>
          <div className={styles.copyRow}>
            <code className={styles.code}>{id}</code>
            <button className={styles.copyBtn} onClick={() => copyText(id, "id")}>
              {copied === "id" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {type === "project" && (
          <div className={styles.row}>
            <span className={styles.label}>Application ID</span>
            <div className={styles.copyRow}>
              <code className={styles.code}>{applicationId || "—"}</code>
              {applicationId && (
                <button className={styles.copyBtn} onClick={() => copyText(applicationId, "appId")}>
                  {copied === "appId" ? "Copied!" : "Copy"}
                </button>
              )}
            </div>
          </div>
        )}

        <div className={styles.row}>
          <span className={styles.label}>Visibility</span>
          <span className={styles.badge}>Public</span>
        </div>

        <div className={styles.divider} />

        <div className={styles.row}>
          <span className={styles.label}>Members</span>
          {loadingMembers ? (
            <span className={styles.muted}>Loading…</span>
          ) : members.length === 0 ? (
            <span className={styles.muted}>No members found</span>
          ) : (
            <div className={styles.memberList}>
              {members.map((m, i) => (
                <div key={i} className={styles.member}>
                  <span className={styles.memberAvatar}>{m[0]?.toUpperCase() ?? "?"}</span>
                  <span className={styles.memberName}>{m}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
