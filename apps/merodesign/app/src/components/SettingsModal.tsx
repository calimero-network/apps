import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { adminGet, adminPut, rpcCall } from "../api/rpc";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { truncateMiddle } from "../utils/format";
import styles from "./SettingsModal.module.css";

/** Contract-level role for a member: "admin" | "editor" | "viewer". */
/** The contract's member record: the username someone chose on joining. */
interface CanvasMember {
  id: string;
  username: string;
}

interface ContractRole {
  member: string;
  role: string;
}

type MemberRole = "Admin" | "Member" | string;

interface MemberEntry {
  identity: string;
  role: MemberRole;
  name?: string;
}

type MembersResponse =
  | MemberEntry[]
  | { members?: MemberEntry[]; data?: MemberEntry[]; selfIdentity?: string; self_identity?: string };

interface Props {
  type: "team" | "project";
  /** The id shown in the header row — namespace id (team) or context id (project). */
  id: string;
  /**
   * The group id (hex 32 bytes) to query members/roles against. For a team this
   * is the namespace id (same as `id`). For a project this is the subgroup id —
   * NOT the base58 context id, which the /groups/{id}/members endpoint rejects
   * with "Invalid group id format: expected hex-encoded 32 bytes".
   */
  groupId?: string;
  name: string;
  onClose: () => void;
}

export default function SettingsModal({ type, id, groupId, name, onClose }: Props) {
  const { applicationId } = useMero();
  const { showToast } = useToast();
  const membersGroupId = groupId || id;
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [selfIdentity, setSelfIdentity] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  // Contract-level (merge-enforced) canvas roles, project boards only.
  const [contractRoles, setContractRoles] = useState<Record<string, string>>({});
  /** Board roster from the contract, so rows show the username someone picked. */
  const [canvasMembers, setCanvasMembers] = useState<CanvasMember[]>([]);
  const [myContractRole, setMyContractRole] = useState<string>("");
  const [pendingEditor, setPendingEditor] = useState<string | null>(null);

  useEffect(() => {
    if (type !== "project") return;
    let cancelled = false;
    Promise.all([
      rpcCall<ContractRole[]>(id, "list_roles", {}).catch(() => [] as ContractRole[]),
      rpcCall<string>(id, "my_role", {}).catch(() => ""),
      rpcCall<CanvasMember[]>(id, "get_members", {}).catch(() => [] as CanvasMember[]),
    ]).then(([roles, mine, canvasMembers]) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      (Array.isArray(roles) ? roles : []).forEach((r) => { if (r?.member) map[r.member] = r.role; });
      setContractRoles(map);
      setMyContractRole(mine || "");
      setCanvasMembers(Array.isArray(canvasMembers) ? canvasMembers : []);
    });
    return () => { cancelled = true; };
  }, [type, id]);

  // The board owner/admin (contract) may grant/revoke the editor role. The grant
  // is admin-gated at merge, so a non-admin's forged grant is rejected by peers.
  async function setEditor(identity: string, makeEditor: boolean) {
    setPendingEditor(identity);
    try {
      await rpcCall(id, makeEditor ? "grant_editor" : "revoke_editor", { member: identity });
      setContractRoles((prev) => ({ ...prev, [identity]: makeEditor ? "editor" : "viewer" }));
      showToast(makeEditor ? "Member can now edit the canvas." : "Member set to view-only.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update canvas role."));
    } finally {
      setPendingEditor(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setLoadingMembers(true);
    adminGet<MembersResponse>(`/groups/${membersGroupId}/members`)
      .then((raw) => {
        if (cancelled) return;
        const arr: MemberEntry[] = Array.isArray(raw)
          ? raw
          : raw.members ?? raw.data ?? [];
        const self = Array.isArray(raw)
          ? ""
          : (raw.selfIdentity ?? raw.self_identity ?? "");
        setMembers(
          arr
            .map((m) => ({
              identity: m.identity ?? (m as { memberId?: string }).memberId ?? (m as { id?: string }).id ?? "",
              role: (m.role as MemberRole) ?? "Member",
              name: m.name?.trim() || undefined,
            }))
            .filter((m) => m.identity),
        );
        setSelfIdentity(self ?? "");
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingMembers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [membersGroupId]);

  const selfIsAdmin =
    !!selfIdentity && members.some((m) => m.identity === selfIdentity && m.role === "Admin");

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  // Promote (→ Admin) / demote (→ Member). Only namespace (team) members carry
  // governance roles; only admins may change them.
  async function changeRole(identity: string, role: "Admin" | "Member") {
    setPendingRole(identity);
    try {
      await adminPut(`/groups/${membersGroupId}/members/${identity}/role`, { role });
      setMembers((prev) => prev.map((m) => (m.identity === identity ? { ...m, role } : m)));
      showToast(role === "Admin" ? "Member promoted to admin." : "Admin demoted to member.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update role."));
    } finally {
      setPendingRole(null);
    }
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
          <span className={styles.label}>
            Members{members.length > 0 ? ` (${members.length})` : ""}
          </span>
          {loadingMembers ? (
            <span className={styles.muted}>Loading…</span>
          ) : members.length === 0 ? (
            <span className={styles.muted}>No members found</span>
          ) : (
            <div className={styles.memberList}>
              {members.map((m) => {
                const isAdmin = m.role === "Admin";
                const isSelf = m.identity === selfIdentity;
                // item 12: prefer the username from the contract over the raw id.
                const canvasName = canvasMembers.find((c) => c.id === m.identity)?.username?.trim();
                const shownName = canvasName || m.name;
                const initial = (shownName?.[0] ?? m.identity[0] ?? "?").toUpperCase();
                const canModerate = type === "team" && selfIsAdmin && !isSelf;
                const busy = pendingRole === m.identity;
                // Contract canvas role (project boards). Admins are implicitly
                // editors; a member is shown as an editor if explicitly granted.
                const contractRole = contractRoles[m.identity];
                const isCanvasEditor = contractRole === "admin" || contractRole === "editor";
                const isCanvasAdmin = contractRole === "admin";
                const canSetEditor =
                  type === "project" && myContractRole === "admin" && !isSelf && !isCanvasAdmin;
                const editorBusy = pendingEditor === m.identity;
                return (
                  <div key={m.identity} className={styles.member}>
                    <span className={styles.memberAvatar}>{initial}</span>
                    <div className={styles.memberInfo}>
                      {shownName && <span className={styles.memberLabel}>{shownName}{isSelf ? " (you)" : ""}</span>}
                      <div className={styles.memberIdRow}>
                        <code className={styles.memberId} title={m.identity}>
                          {truncateMiddle(m.identity, 10, 6)}
                        </code>
                        <button
                          className={styles.copyIcon}
                          onClick={() => copyText(m.identity, m.identity)}
                          title="Copy full identity"
                          aria-label="Copy full identity"
                        >
                          {copied === m.identity ? "✓" : "⧉"}
                        </button>
                        {!shownName && isSelf && <span className={styles.youTag}>you</span>}
                      </div>
                    </div>
                    <span className={`${styles.roleBadge} ${isAdmin ? styles.roleAdmin : styles.roleMember}`}>
                      {isAdmin ? "Admin" : "Member"}
                    </span>
                    {canModerate && (
                      <button
                        className={styles.roleBtn}
                        disabled={busy}
                        onClick={() => changeRole(m.identity, isAdmin ? "Member" : "Admin")}
                      >
                        {busy ? "…" : isAdmin ? "Demote" : "Promote"}
                      </button>
                    )}
                    {type === "project" && contractRole && (
                      <span
                        className={`${styles.roleBadge} ${isCanvasEditor ? styles.roleAdmin : styles.roleMember}`}
                        title="Canvas access (merge-enforced)"
                      >
                        {isCanvasAdmin ? "Owner" : isCanvasEditor ? "Editor" : "Viewer"}
                      </span>
                    )}
                    {canSetEditor && (
                      <button
                        className={styles.roleBtn}
                        disabled={editorBusy}
                        onClick={() => setEditor(m.identity, !isCanvasEditor)}
                        title={isCanvasEditor ? "Revoke canvas edit access" : "Allow this member to edit the canvas"}
                      >
                        {editorBusy ? "…" : isCanvasEditor ? "Make viewer" : "Make editor"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
