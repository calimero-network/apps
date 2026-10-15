import { useEffect, useState } from "react";
import { useMero, useRemoveGroupMembers } from "@calimero-network/mero-react";
import { useMemberNames, useMyName } from "@calimero-apps/names";
import { ShieldCheck } from "@calimero-network/mero-icons";
import { getNodeIdentity, listGroupMembers, rpcCall, updateMemberRole, type GroupMemberInfo } from "../api/rpc";
import { listTeamContexts } from "../api/teamContexts";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { truncateMiddle } from "../utils/format";
import { canRemoveMember, keepsAnAdmin } from "../utils/memberGuards";
import ConfirmDialog from "./ConfirmDialog";
import {
  adminsMissingCanvasAccess,
  indexBoardMembers,
  type CanvasMemberRow as CanvasMember,
  type ContractRoleRow as ContractRole,
} from "../utils/boardMembers";
import styles from "./SettingsSection.module.css";

type MemberRole = "Admin" | "Member" | string;

interface MemberEntry {
  identity: string;
  role: MemberRole;
  name?: string;
}

// No `selfIdentity` on the member listing: rc.23 removed it (#3522). The
// caller's own account comes from `getNodeIdentity()` instead.

interface Props {
  type: "team" | "project";
  /** The id shown in the header row — namespace id (team) or context id (project). */
  id: string;
  /**
   * The group id (hex 32 bytes) to query members/roles against. For a team this
   * is the namespace id (same as `id`). For a project this is the subgroup id —
   * NOT the context id, which the /groups/{id}/members endpoint rejects
   * with "Invalid group id format: expected hex-encoded 32 bytes".
   */
  groupId?: string;
  name: string;
  /**
   * The team (namespace) this belongs to. People's names live on the namespace
   * — the one group everyone is in — so a project's member rows read them from
   * here. Defaults to `id` for a team.
   */
  namespaceId?: string;
}

/**
 * One section of the settings panel: a team's (`type="team"`, the namespace)
 * or a board's (`type="project"`, its subgroup and context). Ids, your name in
 * the team, and the member list with the controls this account may use on it.
 */
export default function SettingsSection({ type, id, groupId, name, namespaceId }: Props) {
  const { applicationId, admin } = useMero();
  const { removeGroupMembers } = useRemoveGroupMembers();
  const teamNamespace = namespaceId ?? (type === "team" ? id : undefined);
  const { nameOf } = useMemberNames(admin, teamNamespace);
  const { showToast } = useToast();
  const membersGroupId = groupId || id;
  const [members, setMembers] = useState<MemberEntry[]>([]);
  // TEE nodes admitted to the group: not people, so never in `members`.
  const [teeMembers, setTeeMembers] = useState<GroupMemberInfo[]>([]);
  const [selfIdentity, setSelfIdentity] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingRole, setPendingRole] = useState<string | null>(null);
  // Contract-level (merge-enforced) canvas roles, project boards only. Keyed by
  // ACCOUNT, because that is what the rows below carry — see `byAccount`.
  const [contractRoles, setContractRoles] = useState<Record<string, string>>({});
  /** Board username per ACCOUNT, so rows show the name someone picked. */
  const [canvasNames, setCanvasNames] = useState<Record<string, string>>({});
  const [myContractRole, setMyContractRole] = useState<string>("");
  const [pendingEditor, setPendingEditor] = useState<string | null>(null);
  // The member a Remove is waiting on confirmation for, and one in flight.
  const [confirmRemove, setConfirmRemove] = useState<MemberEntry | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => {
    if (type !== "project") return;
    let cancelled = false;
    Promise.all([
      rpcCall<ContractRole[]>(id, "list_roles", {}).catch(() => [] as ContractRole[]),
      rpcCall<string>(id, "my_role", {}).catch(() => ""),
      rpcCall<CanvasMember[]>(id, "get_members", {}).catch(() => [] as CanvasMember[]),
    ]).then(([roles, mine, canvasMembers]) => {
      if (cancelled) return;
      // Re-key both contract sources by ACCOUNT — see boardMembers.ts for why
      // the two sources cannot be compared directly.
      const indexed = indexBoardMembers(
        Array.isArray(roles) ? roles : [],
        Array.isArray(canvasMembers) ? canvasMembers : [],
      );
      setContractRoles(indexed.roles);
      setCanvasNames(indexed.names);
      setMyContractRole(mine || "");
    });
    return () => { cancelled = true; };
  }, [type, id]);

  // The board owner/admin (contract) may grant/revoke the editor role. The grant
  // is admin-gated at merge, so a non-admin's forged grant is rejected by peers.
  //
  // `identity` is an ACCOUNT id — the only id this screen has, and exactly what
  // the contract's member ids and grants are keyed by.
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
    setLoadingMembers(true);
    listGroupMembers(membersGroupId)
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members.map((m): MemberEntry => ({ identity: m.identity, role: m.role, name: m.name })));
        setTeeMembers(res.teeMembers);
      })
      .catch(() => {
        if (cancelled) return;
        setMembers([]);
        setTeeMembers([]);
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

  // ── Team Admin implies canvas edit ──────────────────────────────────────────
  //
  // The two role systems are independent: the contract cannot see namespace
  // roles, so a promotion to Admin grants nothing on the board, and the member
  // reads as "Admin" while still being refused every edit. The board is the
  // only place that can close the gap, so whoever opens settings holding board
  // admin reconciles it.
  //
  // Runs only when there is something to fix and only for admins the board has
  // already seen — so the common case issues no calls, and a grant is never
  // sent for an account the contract would refuse anyway.
  useEffect(() => {
    if (type !== "project" || myContractRole !== "admin") return;
    const needed = adminsMissingCanvasAccess(members, contractRoles);
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
          // canvas role, and the explicit button is still there as a fallback.
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
   * Carry a governance change onto every board in the team.
   *
   * Admin implies canvas edit, so the two directions are not symmetric in
   * importance: a promotion that fails to grant just leaves someone needing a
   * manual grant, but a demotion that fails to revoke leaves a former admin
   * still able to edit — which is the one that matters.
   *
   * Runs per board because canvas access is per contract. A board where this
   * caller is not the board admin refuses the call; that is counted and
   * reported rather than swallowed, because silence there would read as
   * "revoked everywhere" when it was not.
   */
  async function cascadeCanvasRole(
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
    if (role === "Member") {
      const guard = keepsAnAdmin(members, identity);
      if (!guard.ok) {
        showToast(guard.reason);
        return;
      }
    }
    setPendingRole(identity);
    try {
      await updateMemberRole(membersGroupId, identity, role);
      setMembers((prev) => prev.map((m) => (m.identity === identity ? { ...m, role } : m)));

      const { changed, failed } = await cascadeCanvasRole(identity, role);
      const base =
        role === "Admin" ? "Member promoted to admin." : "Admin demoted to member.";
      const canvas =
        role === "Admin"
          ? `Canvas edit granted on ${changed} board${changed === 1 ? "" : "s"}.`
          : `Canvas edit revoked on ${changed} board${changed === 1 ? "" : "s"}.`;
      if (failed > 0) {
        // Named explicitly: those boards still have the OLD canvas access.
        showToast(
          `${base} ${canvas} ${failed} board${failed === 1 ? "" : "s"} could not be updated — open its settings as board admin.`,
        );
      } else {
        showToast(changed > 0 ? `${base} ${canvas}` : base, "success");
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not update role."));
    } finally {
      setPendingRole(null);
    }
  }

  /**
   * Take someone out of the team. `identity` is the member's ACCOUNT — what
   * the member listing returns and what removal takes (never a signing key:
   * both are 64 hex, and a key names nobody without an error).
   */
  async function removeMember(member: MemberEntry) {
    setConfirmRemove(null);
    const guard = canRemoveMember(members, selfIdentity, member.identity);
    if (!guard.ok) {
      showToast(guard.reason);
      return;
    }
    setPendingRemove(member.identity);
    try {
      await removeGroupMembers(membersGroupId, { members: [member.identity] });
      setMembers((prev) => prev.filter((m) => m.identity !== member.identity));
      showToast("Member removed from the team.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not remove member."));
    } finally {
      setPendingRemove(null);
    }
  }

  return (
    <div className={styles.section} data-testid={`settings-section-${type}`} aria-label={`${name} settings`}>

        <div className={styles.row}>
          <span className={styles.label}>{type === "project" ? "Board (context) ID" : "Team ID"}</span>
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

        {teamNamespace && selfIdentity && (
          <YourName namespaceId={teamNamespace} selfAccount={selfIdentity} />
        )}

        <div className={styles.divider} />

        <div className={styles.row}>
          <div className={styles.labelRow}>
            <span className={styles.label}>
              Members{members.length > 0 ? ` (${members.length})` : ""}
            </span>
            {teeMembers.length > 0 && (
              <span
                className={styles.teeBadge}
                title="A hardware-attested node keeps this workspace in sync and available when members are offline."
              >
                <ShieldCheck size={12} aria-hidden />
                TEE enabled · {teeMembers.some((m) => m.role === "RelayTee") ? "Relay" : "Replica"}
              </span>
            )}
          </div>
          {loadingMembers ? (
            <span className={styles.muted}>Loading…</span>
          ) : members.length === 0 ? (
            <span className={styles.muted}>No members found</span>
          ) : (
            <div className={styles.memberList}>
              {members.map((m) => {
                const isAdmin = m.role === "Admin";
                const isSelf = m.identity === selfIdentity;
                // item 12: a name, never the raw id. The team name first — it is
                // the one name a person has on every board and in every app —
                // then a board username from before names were per team.
                // Keyed by account — `m.identity` IS an account id here.
                const canvasName = canvasNames[m.identity];
                const shownName = nameOf(m.identity) || canvasName || m.name;
                const initial = (shownName?.[0] ?? m.identity[0] ?? "?").toUpperCase();
                const canModerate = type === "team" && selfIsAdmin && !isSelf;
                const busy = pendingRole === m.identity;
                const demoteGuard = keepsAnAdmin(members, m.identity);
                const removeGuard = canRemoveMember(members, selfIdentity, m.identity);
                const removeBusy = pendingRemove === m.identity;
                // Contract canvas role (project boards). Admins are implicitly
                // editors; a member is shown as an editor if explicitly granted.
                const contractRole = contractRoles[m.identity];
                const isCanvasEditor = contractRole === "admin" || contractRole === "editor";
                const isCanvasAdmin = contractRole === "admin";
                // Not offered for a team admin: canvas edit follows from the
                // Admin role now, so the button would be the redundant control
                // that made the two systems look like one.
                const canSetEditor =
                  type === "project" &&
                  myContractRole === "admin" &&
                  !isSelf &&
                  !isCanvasAdmin &&
                  !isAdmin;
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
                        disabled={busy || (isAdmin && !demoteGuard.ok)}
                        title={isAdmin && !demoteGuard.ok ? demoteGuard.reason : undefined}
                        onClick={() => changeRole(m.identity, isAdmin ? "Member" : "Admin")}
                      >
                        {busy ? "…" : isAdmin ? "Demote" : "Promote"}
                      </button>
                    )}
                    {canModerate && (
                      <button
                        className={`${styles.roleBtn} ${styles.removeBtn}`}
                        disabled={removeBusy || !removeGuard.ok}
                        title={removeGuard.ok ? "Remove from the team" : removeGuard.reason}
                        onClick={() => setConfirmRemove(m)}
                        data-testid={`remove-member-${m.identity}`}
                      >
                        {removeBusy ? "…" : "Remove"}
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
      {confirmRemove && (
        <ConfirmDialog
          title="Remove member?"
          message={`${nameOf(confirmRemove.identity) || confirmRemove.name || truncateMiddle(confirmRemove.identity, 10, 6)} will lose access to ${name} and every board in it. They can rejoin only with a new invitation.`}
          confirmLabel="Remove"
          destructive
          onCancel={() => setConfirmRemove(null)}
          onConfirm={() => void removeMember(confirmRemove)}
        />
      )}
    </div>
  );
}

/**
 * Your name in this team — the one place to change it.
 *
 * It is the team's name for you, not this board's: every board and every app
 * on the team shows it, and boards you are on pick a rename up when opened.
 */
function YourName({ namespaceId, selfAccount }: { namespaceId: string; selfAccount: string }) {
  const { admin } = useMero();
  const { showToast } = useToast();
  const me = useMyName(admin, namespaceId, selfAccount);
  const [draft, setDraft] = useState(me.name);
  const [saving, setSaving] = useState(false);

  // Follow the name as it loads, unless the field is being edited.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(me.name);
  }, [me.name, editing]);

  const trimmed = draft.trim();
  const unchanged = trimmed === me.name;

  async function save() {
    if (trimmed.length < 2 || unchanged) return;
    setSaving(true);
    try {
      await me.setName(trimmed);
      setEditing(false);
      showToast("Name updated for the whole team.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not save your name."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>Your name in this team</span>
      <div className={styles.copyRow}>
        <input
          className={styles.nameInput}
          value={draft}
          maxLength={32}
          placeholder="Your name…"
          aria-label="Your name in this team"
          data-testid="your-name-input"
          onChange={(e) => {
            setEditing(true);
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
        <button
          className={styles.copyBtn}
          onClick={() => void save()}
          disabled={saving || unchanged || trimmed.length < 2}
          data-testid="your-name-save"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
