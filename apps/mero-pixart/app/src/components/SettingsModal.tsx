import { useEffect, useMemo, useState } from "react";
import { RemoveMemberButton, canChangeRole, canRemoveMember } from "@calimero-apps/members";
import "@calimero-apps/members/members.css";
import { useApi } from "../api/useApi";
import { messageOf } from "../api/pixart";
import { useSignedIn } from "../api/sessionContext";
import { PRODUCT_NAME, isAdmin, removeTeamMember } from "../api/teams";
import { useTeam } from "../api/useTeam";
import { useToast } from "../contexts/ToastContext";
import { effectiveDocumentRole } from "../utils/documentRoles";
import { truncateMiddle } from "../utils/format";
import { useEditorStore } from "../store/editorStore";
import type { DocumentInfo, MemberRole as ContractMemberRole } from "../types";
import styles from "./SettingsModal.module.css";
import { passkeyConfirm } from "@calimero-network/mero-js";

interface Props {
  type: "team" | "project";
  /** The id shown in the header row: the team (org) id, or the project (app instance) id. */
  id: string;
  /** The team (org) whose people are listed. Defaults to `id` for a team. */
  namespaceId?: string;
  name: string;
  onClose: () => void;
}

const TEAM_ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

/**
 * A team's or a project's settings.
 *
 * Team: its people (org members) with their roles; the team's owner and admins
 * promote, demote and remove them (each a passkey step-up).
 *
 * Project: the document's name and size (its owner), and the team's people with
 * their document role beside their team role; the document's owner makes them
 * editors, viewers or the new owner. The team's owner and admins always edit,
 * so v1's "promote cascades to every document" step is gone: the contract
 * reads the team role itself.
 */
export default function SettingsModal({ type, id, name, namespaceId, onClose }: Props) {
  const api = useApi();
  const pix = useMemo(() => api.app(id), [api, id]);
  const { client, accountId: selfIdentity, passkey, source, after } = useSignedIn();
  const { showToast } = useToast();
  const teamId = namespaceId ?? (type === "team" ? id : undefined);
  const team = useTeam(teamId);
  const [copied, setCopied] = useState<string | null>(null);
  const [busyMember, setBusyMember] = useState<string | null>(null);

  // Document roles (project only).
  const [contractRoles, setContractRoles] = useState<Record<string, string>>({});
  const [myContractRole, setMyContractRole] = useState<string>("");
  const [pendingEditor, setPendingEditor] = useState<string | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<string | null>(null);

  // Document metadata (project only): rename + resize via update_document.
  const [doc, setDoc] = useState<DocumentInfo | null>(null);
  const [docName, setDocName] = useState("");
  const [docW, setDocW] = useState("");
  const [docH, setDocH] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);

  useEffect(() => {
    if (type !== "project") return;
    let cancelled = false;
    Promise.all([
      (pix.listRoles() as Promise<ContractMemberRole[]>).catch(() => [] as ContractMemberRole[]),
      (pix.myRole() as Promise<string>).catch(() => ""),
      pix.getDocument().catch(() => null),
    ]).then(([roles, mine, document]) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      (Array.isArray(roles) ? roles : []).forEach((r) => { if (r?.member) map[r.member] = r.role; });
      setContractRoles(map);
      setMyContractRole(mine || "");
      if (document) {
        setDoc(document);
        setDocName(document.name ?? "");
        setDocW(String(document.width ?? ""));
        setDocH(String(document.height ?? ""));
      }
    });
    return () => { cancelled = true; };
  }, [type, id, pix]);

  // The document owner grants or revokes the editor role.
  async function setEditor(identity: string, makeEditor: boolean) {
    setPendingEditor(identity);
    try {
      await (makeEditor ? pix.grantEditor({ member: identity }) : pix.revokeEditor({ member: identity }));
      setContractRoles((prev) => ({ ...prev, [identity]: makeEditor ? "editor" : "viewer" }));
      showToast(makeEditor ? "Member can now edit the document." : "Member set to view-only.", "success");
    } catch (err) {
      showToast(`Could not update editor role: ${messageOf(err)}`);
    } finally {
      setPendingEditor(null);
    }
  }

  // Owner-only: hand the document's owner role to another member.
  async function transferOwnership(identity: string) {
    setPendingTransfer(identity);
    try {
      await pix.transferOwnership({ newOwner: identity });
      setContractRoles((prev) => ({ ...prev, [identity]: "admin", [selfIdentity]: "editor" }));
      setMyContractRole("editor");
      showToast("Ownership transferred.", "success");
    } catch (err) {
      showToast(`Could not transfer ownership: ${messageOf(err)}`);
    } finally {
      setPendingTransfer(null);
    }
  }

  async function saveDocument() {
    const w = Math.round(Number(docW));
    const h = Math.round(Number(docH));
    if (!docName.trim()) { showToast("Document name cannot be empty."); return; }
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 8192 || h > 8192) {
      showToast("Enter a valid canvas size (1–8192 px).");
      return;
    }
    setSavingDoc(true);
    try {
      await pix.updateDocument({ name: docName.trim(), width: w, height: h });
      setDoc((prev) => (prev ? { ...prev, name: docName.trim(), width: w, height: h } : prev));
      // Reflect the new size in the live editor immediately and drop any stale
      // selection marquee left over at the old canvas bounds.
      const cur = useEditorStore.getState().doc;
      if (cur) useEditorStore.getState().setDoc({ ...cur, name: docName.trim(), width: w, height: h });
      useEditorStore.getState().setSelection(null);
      showToast("Document updated.", "success");
    } catch (err) {
      showToast(`Could not update document: ${messageOf(err)}`);
    } finally {
      setSavingDoc(false);
    }
  }

  // ── Team roles (team settings) ──────────────────────────────────────────────

  // Who has Mero Pixart in the team (its app team, else the org), with their org role.
  const members = team.people
    .map((identity) => ({ identity, role: team.roles.get(identity) ?? "member" }))
    .sort((a, b) =>
      a.identity === selfIdentity ? -1 : b.identity === selfIdentity ? 1 : a.identity.localeCompare(b.identity),
    );
  const myTeamRole = team.roles.get(selfIdentity);
  const canManage = isAdmin(myTeamRole);
  const adminCount = members.filter((m) => isAdmin(m.role)).length;

  async function changeTeamRole(identity: string, current: string, next: "admin" | "member") {
    if (current === next) return;
    const verdict = canChangeRole({
      canManage,
      isSelf: identity === selfIdentity,
      currentRole: current === "admin" ? "Admin" : "Member",
      nextRole: next === "admin" ? "Admin" : "Member",
      adminCount,
    });
    if (!verdict.allowed) {
      showToast(verdict.reason ?? "That change is not allowed.");
      return;
    }
    setBusyMember(identity);
    try {
      await client.orgs.setMember(
        { org: teamId!, account: identity, role: next },
        { confirm: passkeyConfirm(passkey()) },
      );
      showToast(
        next === "admin"
          ? "Member promoted to admin: they manage the team and edit every document."
          : "Admin demoted to member.",
        "success",
      );
    } catch (err) {
      showToast(`Could not change that role: ${messageOf(err)}`);
    } finally {
      after();
      team.reload();
      setBusyMember(null);
    }
  }

  async function removeMember(identity: string) {
    setBusyMember(identity);
    try {
      const left = await removeTeamMember(client, teamId!, source, identity, passkey);
      showToast(
        left === "app"
          ? `Member removed from ${PRODUCT_NAME}. They stay in the organization and its other apps.`
          : "Member removed from the team.",
        "success",
      );
    } catch (err) {
      showToast(`Could not remove that member: ${messageOf(err)}`);
    } finally {
      after();
      team.reload();
      setBusyMember(null);
    }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="mp-overlay" onClick={onClose}>
      <div className={`mp-modal ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{name} — Settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Document metadata (project only) */}
        {type === "project" && doc && (
          <>
            <div className={styles.row}>
              <span className="mp-label">Document</span>
              <input
                className="mp-input"
                value={docName}
                onChange={(e) => setDocName(e.target.value)}
                placeholder="Document name"
                disabled={myContractRole !== "admin"}
                data-testid="doc-name"
              />
              <div className={styles.dimRow}>
                <input
                  className="mp-input"
                  type="number" min={1} max={8192}
                  value={docW}
                  onChange={(e) => setDocW(e.target.value)}
                  disabled={myContractRole !== "admin"}
                  data-testid="doc-width"
                />
                <span className={styles.dimTimes}>×</span>
                <input
                  className="mp-input"
                  type="number" min={1} max={8192}
                  value={docH}
                  onChange={(e) => setDocH(e.target.value)}
                  disabled={myContractRole !== "admin"}
                  data-testid="doc-height"
                />
                <span className={styles.dimUnit}>px</span>
                <button
                  className="mp-btn mp-btn--primary"
                  onClick={saveDocument}
                  disabled={savingDoc || myContractRole !== "admin"}
                  data-testid="save-doc"
                >
                  {savingDoc ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
            <div className={styles.divider} />
          </>
        )}

        <div className={styles.row}>
          <span className="mp-label">{type === "project" ? "Project ID" : "Team ID"}</span>
          <div className={styles.copyRow}>
            <code className={styles.code}>{id}</code>
            <button className={styles.copyBtn} onClick={() => copyText(id, "id")}>
              {copied === "id" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className={styles.divider} />

        <div className={styles.row}>
          <div className={styles.labelRow}>
            <span className="mp-label">
              Members{members.length > 0 ? ` (${members.length})` : ""}
            </span>
          </div>
          {!team.ready ? (
            <span className={styles.muted}>Loading…</span>
          ) : members.length === 0 ? (
            <span className={styles.muted}>No members found</span>
          ) : (
            <div className={styles.memberList} data-testid="member-list">
              {members.map((m) => {
                const isSelf = m.identity === selfIdentity;
                const shownName = team.nameOf(m.identity);
                const initial = (shownName?.[0] ?? m.identity[0] ?? "?").toUpperCase();
                const documentRole = effectiveDocumentRole(contractRoles, m.identity, m.role);
                const isEditor = documentRole !== "viewer";
                const isOwner = documentRole === "admin";
                // Team owners and admins edit whatever the document says, so
                // there is nothing to grant them.
                const canSetEditor =
                  type === "project" && myContractRole === "admin" && !isSelf && !isOwner && !isAdmin(m.role);
                const canTransfer =
                  type === "project" && myContractRole === "admin" && !isSelf && !isOwner;
                const movable = type === "team" && canManage && !isSelf && (m.role === "admin" || m.role === "member");
                const removable =
                  type === "team" &&
                  m.role !== "owner" &&
                  canRemoveMember({ canManage, isSelf, role: m.role, adminCount }).allowed;
                const busy = busyMember === m.identity;
                return (
                  <div key={m.identity} className={styles.member} data-testid={`member-${m.identity}`}>
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
                          title="Copy account id"
                          aria-label="Copy account id"
                        >
                          {copied === m.identity ? "✓" : "⧉"}
                        </button>
                        {!shownName && isSelf && <span className={styles.youTag}>you</span>}
                      </div>
                    </div>
                    {movable ? (
                      <select
                        className={styles.roleBtn}
                        value={m.role}
                        disabled={busy}
                        onChange={(e) => void changeTeamRole(m.identity, m.role, e.target.value as "admin" | "member")}
                        aria-label="Team role"
                        data-testid={`team-role-${m.identity}`}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span
                        className={`${styles.roleBadge} ${isAdmin(m.role) ? styles.roleAdmin : styles.roleMember}`}
                        title="Team role"
                      >
                        {TEAM_ROLE_LABEL[m.role] ?? m.role}
                      </span>
                    )}
                    {type === "project" && (
                      <span
                        className={`${styles.roleBadge} ${isEditor ? styles.roleAdmin : styles.roleMember}`}
                        title="Document access"
                      >
                        {isOwner ? "Owner" : isEditor ? "Editor" : "Viewer"}
                      </span>
                    )}
                    {canSetEditor && (
                      <button
                        className={styles.roleBtn}
                        disabled={pendingEditor === m.identity}
                        onClick={() => setEditor(m.identity, !isEditor)}
                        title={isEditor ? "Revoke edit access" : "Allow this member to edit the document"}
                      >
                        {pendingEditor === m.identity ? "…" : isEditor ? "Make viewer" : "Make editor"}
                      </button>
                    )}
                    {canTransfer && (
                      <button
                        className={styles.roleBtn}
                        disabled={pendingTransfer === m.identity}
                        onClick={() => transferOwnership(m.identity)}
                        title="Transfer document ownership to this member"
                      >
                        {pendingTransfer === m.identity ? "…" : "Make owner"}
                      </button>
                    )}
                    {removable && (
                      <RemoveMemberButton
                        label={shownName || truncateMiddle(m.identity, 10, 6)}
                        disabled={busy}
                        prompt={`Remove ${shownName || "this member"} from the team?`}
                        onConfirm={() => void removeMember(m.identity)}
                      />
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
