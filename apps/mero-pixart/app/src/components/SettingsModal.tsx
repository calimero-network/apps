import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { adminGet, adminPut, getNodeIdentity, rpcCall } from "../api/rpc";
import { listTeamContexts } from "../api/teamContexts";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import {
  adminsMissingDocumentAccess,
  effectiveDocumentRole,
} from "../utils/documentRoles";
import { truncateMiddle } from "../utils/format";
import { useEditorStore } from "../store/editorStore";
import type { DocumentInfo, MemberRole as ContractMemberRole } from "../types";
import styles from "./SettingsModal.module.css";

type GovRole = "Admin" | "Member" | string;

interface MemberEntry {
  identity: string;
  role: GovRole;
  name?: string;
}

// No `selfIdentity` here: rc.23 removed it from this response (#3522). The
// caller's own account comes from `getNodeIdentity()` instead.
type MembersResponse =
  | MemberEntry[]
  | { members?: MemberEntry[]; data?: MemberEntry[] };

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

  // Contract-level (merge-enforced) editor roles, project documents only.
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
        setDocName(document.name ?? "");
        setDocW(String(document.width ?? ""));
        setDocH(String(document.height ?? ""));
      }
    });
    return () => { cancelled = true; };
  }, [type, id]);

  // The document owner/admin (contract) may grant/revoke the editor role. The
  // grant is admin-gated at merge, so a non-admin's forged grant is rejected by peers.
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

  // Owner-only: hand the document's owner role to another member.
  async function transferOwnership(identity: string) {
    setPendingTransfer(identity);
    try {
      await rpcCall(id, "transfer_ownership", { new_owner: identity });
      setContractRoles((prev) => ({ ...prev, [identity]: "admin" }));
      setMyContractRole("editor");
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
      // Reflect the new size in the live editor immediately (don't wait for an
      // SSE refetch, which may not fire locally) and drop any stale selection
      // marquee left over at the old canvas bounds.
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

  // Who this node is, asked node-level. Not tied to `membersGroupId`: one
  // account serves every namespace, so this is fetched once per modal.
  useEffect(() => {
    let cancelled = false;
    getNodeIdentity()
      .then((me) => {
        if (!cancelled) setSelfIdentity(me.accountId ?? "");
      })
      .catch(() => {
        // A node that cannot say who it is leaves moderation disabled rather
        // than guessing an identity and offering controls that would 403.
        if (!cancelled) setSelfIdentity("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The members endpoint only accepts a hex-encoded 32-byte group id; a base58
    // context id (the fallback when no group id is resolved) is rejected with a
    // 400 and would surface as an empty list. Skip the doomed request instead.
    if (!/^[0-9a-fA-F]{64}$/.test(membersGroupId)) {
      setMembers([]);
      setLoadingMembers(false);
      return;
    }
    setLoadingMembers(true);
    adminGet<MembersResponse>(`/groups/${membersGroupId}/members`)
      .then((raw) => {
        if (cancelled) return;
        const arr: MemberEntry[] = Array.isArray(raw) ? raw : raw.members ?? raw.data ?? [];
        setMembers(
          arr
            .map((m) => ({
              identity: m.identity ?? (m as { memberId?: string }).memberId ?? (m as { id?: string }).id ?? "",
              role: (m.role as GovRole) ?? "Member",
              name: m.name?.trim() || undefined,
            }))
            .filter((m) => m.identity),
        );
      })
      .catch(() => { if (!cancelled) setMembers([]); })
      .finally(() => { if (!cancelled) setLoadingMembers(false); });
    return () => { cancelled = true; };
  }, [membersGroupId]);

  const selfIsAdmin =
    !!selfIdentity && members.some((m) => m.identity === selfIdentity && m.role === "Admin");

  // ── Team Admin implies document edit ────────────────────────────────────────
  //
  // The two role systems are independent: the contract cannot see team roles, so
  // a promotion grants nothing on the document and the member reads as "Admin"
  // while still being refused every edit. Promote/demote cascades from team
  // settings, but an admin promoted before this existed — or on a document that
  // refused the call then — is only reachable from the document itself, so
  // whoever opens settings holding document admin reconciles it.
  //
  // Runs only when there is something to fix, so the common case issues no calls.
  useEffect(() => {
    if (type !== "project" || myContractRole !== "admin") return;
    const needed = adminsMissingDocumentAccess(members, contractRoles);
    if (needed.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const identity of needed) {
        try {
          await rpcCall(id, "grant_editor", { member: identity });
          if (cancelled) return;
          setContractRoles((prev) => ({ ...prev, [identity]: "editor" }));
        } catch {
          // Non-fatal and deliberately quiet: the row keeps showing the real
          // document role, and the explicit button is still there as a fallback.
        }
      }
    })();
    return () => { cancelled = true; };
  }, [type, id, members, contractRoles, myContractRole]);

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  /**
   * Carry a governance change onto every document in the team.
   *
   * Admin implies document edit, so the two directions are not symmetric in
   * importance: a promotion that fails to grant just leaves someone needing a
   * manual grant, but a demotion that fails to revoke leaves a former admin
   * still able to edit — which is the one that matters.
   *
   * Runs per document because access is per contract. A document where this
   * caller is not the admin refuses the call; that is counted and reported
   * rather than swallowed, because silence there would read as "revoked
   * everywhere" when it was not.
   */
  async function cascadeDocumentRole(
    identity: string,
    role: "Admin" | "Member",
  ): Promise<{ changed: number; failed: number }> {
    const contexts = await listTeamContexts(membersGroupId);
    const method = role === "Admin" ? "grant_editor" : "revoke_editor";
    let changed = 0;
    let failed = 0;
    for (const contextId of contexts) {
      try {
        await rpcCall(contextId, method, { member: identity });
        changed += 1;
      } catch {
        failed += 1;
      }
    }
    return { changed, failed };
  }

  // Promote (→ Admin) / demote (→ Member). Only namespace (team) members carry
  // governance roles; only admins may change them.
  async function changeRole(identity: string, role: "Admin" | "Member") {
    setPendingRole(identity);
    try {
      await adminPut(`/groups/${membersGroupId}/members/${identity}/role`, { role });
      setMembers((prev) => prev.map((m) => (m.identity === identity ? { ...m, role } : m)));

      const { changed, failed } = await cascadeDocumentRole(identity, role);
      const base =
        role === "Admin" ? "Member promoted to admin." : "Admin demoted to member.";
      const docs =
        role === "Admin"
          ? `Edit access granted on ${changed} document${changed === 1 ? "" : "s"}.`
          : `Edit access revoked on ${changed} document${changed === 1 ? "" : "s"}.`;
      if (failed > 0) {
        // Named explicitly: those documents still have the OLD access.
        showToast(
          `${base} ${docs} ${failed} document${failed === 1 ? "" : "s"} could not be updated — open its settings as document admin.`,
        );
        return;
      }
      showToast(changed > 0 ? `${base} ${docs}` : base, "success");
      return;
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update role."));
    } finally {
      setPendingRole(null);
    }
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
                disabled={myContractRole === "viewer"}
                data-testid="doc-name"
              />
              <div className={styles.dimRow}>
                <input
                  className="mp-input"
                  type="number" min={1} max={8192}
                  value={docW}
                  onChange={(e) => setDocW(e.target.value)}
                  disabled={myContractRole === "viewer"}
                  data-testid="doc-width"
                />
                <span className={styles.dimTimes}>×</span>
                <input
                  className="mp-input"
                  type="number" min={1} max={8192}
                  value={docH}
                  onChange={(e) => setDocH(e.target.value)}
                  disabled={myContractRole === "viewer"}
                  data-testid="doc-height"
                />
                <span className={styles.dimUnit}>px</span>
                <button
                  className="mp-btn mp-btn--primary"
                  onClick={saveDocument}
                  disabled={savingDoc || myContractRole === "viewer"}
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
          <span className="mp-label">{type === "project" ? "Context ID" : "Group ID"}</span>
          <div className={styles.copyRow}>
            <code className={styles.code}>{id}</code>
            <button className={styles.copyBtn} onClick={() => copyText(id, "id")}>
              {copied === "id" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {type === "project" && (
          <div className={styles.row}>
            <span className="mp-label">Application ID</span>
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

        <div className={styles.divider} />

        <div className={styles.row}>
          <span className="mp-label">
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
                const initial = (m.name?.[0] ?? m.identity[0] ?? "?").toUpperCase();
                const canModerate = type === "team" && selfIsAdmin && !isSelf;
                const busy = pendingRole === m.identity;
                // Document role. `list_roles` only enumerates members who have
                // opened the document, so an absent entry means plain viewer —
                // which is exactly what the contract's own `get_role` answers
                // for an account it has never seen.
                const documentRole = effectiveDocumentRole(contractRoles, m.identity);
                const isEditor = documentRole !== "viewer";
                const isOwner = documentRole === "admin";
                // No "has this member opened it yet" gate. That guarded the
                // rc.20 model, where the contract had to learn a member's
                // device→account pairing from their own writes before a grant
                // could name them. A member id IS an account here, so
                // `require_account` is a parse and a grant works before the
                // invitee has ever opened the document — see the contract test
                // `a_member_can_be_granted_before_they_ever_open_the_document`.
                // Keeping the gate hid the control from precisely the members
                // who needed it.
                const canSetEditor =
                  type === "project" && myContractRole === "admin" && !isSelf && !isOwner;
                const canTransfer =
                  type === "project" && myContractRole === "admin" && !isSelf && !isOwner;
                const editorBusy = pendingEditor === m.identity;
                const transferBusy = pendingTransfer === m.identity;
                return (
                  <div key={m.identity} className={styles.member}>
                    <span className={styles.memberAvatar}>{initial}</span>
                    <div className={styles.memberInfo}>
                      {m.name && <span className={styles.memberLabel}>{m.name}{isSelf ? " (you)" : ""}</span>}
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
                        {!m.name && isSelf && <span className={styles.youTag}>you</span>}
                      </div>
                    </div>
                    {/* Team role, shown in BOTH scopes. In project settings the
                        two badges sit side by side, so it is visible that team
                        governance and document access are different things. */}
                    <span
                      className={`${styles.roleBadge} ${isAdmin ? styles.roleAdmin : styles.roleMember}`}
                      title="Team role (namespace governance)"
                    >
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
                    {/* Document access, for EVERY member — not only those the
                        document has already heard from, who were the only rows
                        that used to get a badge at all. */}
                    {type === "project" && (
                      <span
                        className={`${styles.roleBadge} ${isEditor ? styles.roleAdmin : styles.roleMember}`}
                        title="Document access (merge-enforced)"
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
