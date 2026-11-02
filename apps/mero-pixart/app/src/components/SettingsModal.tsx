import { useCallback, useEffect, useState } from "react";
import { isTeamAdmin, listProjects, readMembers } from "../api/teams";
import { useApi } from "../api/useApi";
import { useSignedIn } from "../sessionContext";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { adminsMissingDocumentAccess, effectiveDocumentRole } from "../utils/documentRoles";
import { truncateMiddle } from "../utils/format";
import { useEditorStore } from "../store/editorStore";
import type { DocumentInfo, MemberRole as ContractMemberRole } from "../types";
import styles from "./SettingsModal.module.css";

/** An org member as the list shows them. */
interface MemberEntry {
  identity: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
  name?: string;
}

interface Props {
  type: "team" | "project";
  /** The org id (team) or the app instance id (project). */
  id: string;
  /** The team (org) a project belongs to: its members and names. Defaults to `id` for a team. */
  namespaceId?: string;
  name: string;
  onClose: () => void;
}

const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };

/**
 * A team's or a project's settings.
 *
 * Two role systems meet here, as in v1:
 *   * TEAM roles: the org's (owner / admin / member / guest), changed with a
 *     passkey (`setMember`, `removeMember`). v1: namespace governance.
 *   * DOCUMENT access: the contract's own (admin = the document's owner,
 *     editor, viewer), granted by the document's owner.
 * Admin implies edit: promoting someone grants them edit on every project the
 * caller owns, demoting revokes it, and a document owner opening a project's
 * settings grants edit to any team admin still missing it.
 */
export default function SettingsModal({ type, id, name, namespaceId, onClose }: Props) {
  const { client, accountId, source, passkey, after } = useSignedIn();
  const api = useApi();
  const rpcCall = api.call;
  const { showToast } = useToast();
  const org = namespaceId ?? (type === "team" ? id : undefined);
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);

  // Contract-level editor roles, project documents only.
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

  const myTeamRole = members.find((m) => m.identity === accountId)?.role;

  const loadMembers = useCallback(async () => {
    if (!org) return;
    setLoadingMembers(true);
    try {
      const m = await readMembers(client, org);
      setMembers(
        [...m.roles.entries()]
          .map(([identity, role]) => ({ identity, role, name: m.names.get(identity) }))
          .sort((a, b) => (a.name ?? a.identity).localeCompare(b.name ?? b.identity)),
      );
    } catch {
      setMembers([]);
    } finally {
      setLoadingMembers(false);
      after();
    }
  }, [client, org, after]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  useEffect(() => {
    if (type !== "project") return;
    let cancelled = false;
    Promise.all([
      rpcCall<ContractMemberRole[]>(id, "list_roles", {}).catch(() => [] as ContractMemberRole[]),
      rpcCall<string>(id, "my_role", {}).catch(() => ""),
      rpcCall<DocumentInfo>(id, "get_document", {}).catch(() => null),
    ]).then(([roles, mine, document]) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      (Array.isArray(roles) ? roles : []).forEach((r) => { if (r?.member) map[r.member] = r.role; });
      setContractRoles(map);
      setMyContractRole(mine || "");
      if (document) {
        setDoc(document);
        setDocName(document.name || name);
        setDocW(String(document.width ?? ""));
        setDocH(String(document.height ?? ""));
        // `list_roles` covers the document's roster only; the owner and the
        // editors who never opened it are asked one by one.
        if (document.owner) map[document.owner] = "admin";
      }
    });
    return () => { cancelled = true; };
  }, [type, id, name, rpcCall]);

  // Roles of org members the document's roster does not list.
  useEffect(() => {
    if (type !== "project" || members.length === 0) return;
    let cancelled = false;
    (async () => {
      const missing = members.filter((m) => !(m.identity in contractRoles));
      for (const m of missing) {
        const role = await rpcCall<string>(id, "get_role", { member: m.identity }).catch(() => "viewer");
        if (cancelled) return;
        setContractRoles((prev) => (m.identity in prev ? prev : { ...prev, [m.identity]: role }));
      }
    })();
    return () => { cancelled = true; };
  }, [type, id, members, contractRoles, rpcCall]);

  // ── Team admin implies document edit ────────────────────────────────────────
  // Whoever opens settings holding document admin grants edit to the team's
  // admins still missing it. Runs only when there is something to fix.
  useEffect(() => {
    if (type !== "project" || myContractRole !== "admin") return;
    const roster = members.map((m) => ({ identity: m.identity, role: isTeamAdmin(m.role) ? "Admin" : "Member" }));
    const needed = adminsMissingDocumentAccess(roster, contractRoles).filter((who) => who !== accountId);
    if (needed.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const identity of needed) {
        try {
          await rpcCall(id, "grant_editor", { member: identity });
          if (cancelled) return;
          setContractRoles((prev) => ({ ...prev, [identity]: "editor" }));
        } catch {
          // Quiet: the row keeps showing the real document role, and the
          // explicit button is still there.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [type, id, members, contractRoles, myContractRole, accountId, rpcCall]);

  // The document owner may grant/revoke the editor role.
  async function setEditor(identity: string, makeEditor: boolean) {
    setPendingEditor(identity);
    try {
      await rpcCall(id, makeEditor ? "grant_editor" : "revoke_editor", { member: identity });
      setContractRoles((prev) => ({ ...prev, [identity]: makeEditor ? "editor" : "viewer" }));
      showToast(makeEditor ? "Member can now edit the document." : "Member set to view-only.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update editor role."));
    } finally {
      setPendingEditor(null);
    }
  }

  // Owner only: hand the document's owner role to another member.
  async function transferOwnership(identity: string) {
    setPendingTransfer(identity);
    try {
      await rpcCall(id, "transfer_ownership", { new_owner: identity });
      setContractRoles((prev) => ({ ...prev, [identity]: "admin", [accountId]: "viewer" }));
      setMyContractRole("viewer");
      showToast("Ownership transferred.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not transfer ownership."));
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
      await rpcCall(id, "update_document", { name: docName.trim(), width: w, height: h });
      setDoc((prev) => (prev ? { ...prev, name: docName.trim(), width: w, height: h } : prev));
      // Reflect the new size in the live editor immediately and drop any
      // stale selection marquee left over at the old canvas bounds.
      const cur = useEditorStore.getState().doc;
      if (cur) useEditorStore.getState().setDoc({ ...cur, name: docName.trim(), width: w, height: h });
      useEditorStore.getState().setSelection(null);
      showToast("Document updated.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update document."));
    } finally {
      setSavingDoc(false);
    }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  /**
   * Carry a team role change onto every project in the team the caller owns:
   * a promotion grants edit, a demotion revokes it. Counted, not swallowed: a
   * project the caller does not own refuses, and silence there would read as
   * "revoked everywhere".
   */
  async function cascadeDocumentRole(identity: string, admin: boolean): Promise<{ changed: number; failed: number }> {
    if (!org) return { changed: 0, failed: 0 };
    const projects = await listProjects(client, source, org).catch(() => []);
    let changed = 0;
    let failed = 0;
    for (const p of projects) {
      try {
        await rpcCall(p.contextId, admin ? "grant_editor" : "revoke_editor", { member: identity });
        changed += 1;
      } catch {
        failed += 1;
      }
    }
    return { changed, failed };
  }

  // Team owner/admin: promote a member to admin, or demote an admin. A passkey step-up.
  async function setTeamRole(identity: string, role: "admin" | "member") {
    if (!org) return;
    setPendingRole(identity);
    try {
      await client.setMember(org, identity, role, passkey());
      setMembers((prev) => prev.map((m) => (m.identity === identity ? { ...m, role } : m)));
      const { changed, failed } = await cascadeDocumentRole(identity, role === "admin");
      const base = role === "admin" ? "Member promoted to admin." : "Admin demoted to member.";
      const docs = role === "admin"
        ? `Edit access granted on ${changed} project${changed === 1 ? "" : "s"}.`
        : `Edit access revoked on ${changed} project${changed === 1 ? "" : "s"}.`;
      if (failed > 0) {
        showToast(`${base} ${docs} ${failed} project${failed === 1 ? "" : "s"} could not be updated — open its settings as its owner.`);
      } else {
        showToast(changed > 0 ? `${base} ${docs}` : base, "success");
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not change the role."));
    } finally {
      setPendingRole(null);
      after();
    }
  }

  // Team owner/admin: remove someone from the team. A passkey step-up.
  async function removeFromTeam(identity: string) {
    if (!org) return;
    setPendingRole(identity);
    try {
      await client.removeMember(org, identity, passkey());
      setMembers((prev) => prev.filter((m) => m.identity !== identity));
      showToast("Removed from the team.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not remove the member."));
    } finally {
      setPendingRole(null);
      after();
    }
  }

  return (
    <div className="mp-overlay" onClick={onClose}>
      <div className={`mp-modal ${styles.modal}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{name} — Settings</h2>
          <button className={styles.close} onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Document metadata (project only); its owner changes it. */}
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
          <span className="mp-label">{type === "project" ? "Project (app) ID" : "Team (organization) ID"}</span>
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
          {loadingMembers && members.length === 0 ? (
            <span className={styles.muted}>Loading…</span>
          ) : members.length === 0 ? (
            <span className={styles.muted}>No members found</span>
          ) : (
            <div className={styles.memberList}>
              {members.map((m) => {
                const isSelf = m.identity === accountId;
                const shownName = m.name;
                const initial = (shownName?.[0] ?? m.identity[0] ?? "?").toUpperCase();
                const documentRole = effectiveDocumentRole(contractRoles, m.identity);
                const isEditor = documentRole !== "viewer";
                const isOwner = documentRole === "admin";
                const canSetEditor = type === "project" && myContractRole === "admin" && !isSelf && !isOwner;
                const canTransfer = type === "project" && myContractRole === "admin" && !isSelf && !isOwner;
                // Team roles: an owner or admin promotes, demotes and removes;
                // nobody changes the owner.
                const canManage = type === "team" && isTeamAdmin(myTeamRole) && !isSelf && m.role !== "owner";
                const editorBusy = pendingEditor === m.identity;
                const transferBusy = pendingTransfer === m.identity;
                const roleBusy = pendingRole === m.identity;
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
                          title="Copy account id"
                          aria-label="Copy account id"
                        >
                          {copied === m.identity ? "✓" : "⧉"}
                        </button>
                        {!shownName && isSelf && <span className={styles.youTag}>you</span>}
                      </div>
                    </div>
                    <span
                      className={`${styles.roleBadge} ${isTeamAdmin(m.role) ? styles.roleAdmin : styles.roleMember}`}
                      title="Team role (the organization's)"
                    >
                      {ROLE_LABEL[m.role] ?? m.role}
                    </span>
                    {type === "project" && (
                      <span
                        className={`${styles.roleBadge} ${isEditor ? styles.roleAdmin : styles.roleMember}`}
                        title="Document access (checked by the contract)"
                      >
                        {isOwner ? "Owner" : isEditor ? "Editor" : "Viewer"}
                      </span>
                    )}
                    {canSetEditor && (
                      <button
                        className={styles.roleBtn}
                        disabled={editorBusy}
                        onClick={() => setEditor(m.identity, !isEditor)}
                        title={isEditor ? "Revoke edit access" : "Allow this member to edit the document"}
                      >
                        {editorBusy ? "…" : isEditor ? "Make viewer" : "Make editor"}
                      </button>
                    )}
                    {canTransfer && (
                      <button
                        className={styles.roleBtn}
                        disabled={transferBusy}
                        onClick={() => transferOwnership(m.identity)}
                        title="Transfer document ownership to this member"
                      >
                        {transferBusy ? "…" : "Make owner"}
                      </button>
                    )}
                    {canManage && (
                      <>
                        <button
                          className={styles.roleBtn}
                          disabled={roleBusy}
                          onClick={() => setTeamRole(m.identity, isTeamAdmin(m.role) ? "member" : "admin")}
                          title={isTeamAdmin(m.role) ? "Demote to member" : "Promote to admin"}
                        >
                          {roleBusy ? "…" : isTeamAdmin(m.role) ? "Make member" : "Make admin"}
                        </button>
                        <button
                          className={styles.roleBtn}
                          disabled={roleBusy}
                          onClick={() => removeFromTeam(m.identity)}
                          title="Remove from the team"
                        >
                          Remove
                        </button>
                      </>
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
