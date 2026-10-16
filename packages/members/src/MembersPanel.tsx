import { useMemo, useState, type ReactNode } from "react";
import { sameAccount, shortAccount, useMemberNames } from "@calimero-apps/names";

import { RemoveMemberButton } from "./RemoveMemberButton";
import {
  MEMBER_ROLES,
  canChangeRole,
  canRemoveMember,
  countAdmins,
  isAdminRole,
  memberRoleOf,
  roleLabel,
  type MemberRole,
} from "./roles";
import {
  useWorkspaceMembers,
  type MembersAdmin,
  type WorkspaceMember,
} from "./useWorkspaceMembers";

export interface MembersPanelProps {
  /** `useMero().admin`: the session-aware client, never the raw one. */
  admin: MembersAdmin | null | undefined;
  /** The group whose roster this is: the namespace for a workspace. */
  groupId: string | null | undefined;
  /**
   * Where people's names are read: the namespace, the one group everyone is
   * in. Defaults to `groupId`, which is right for a workspace roster.
   */
  namespaceId?: string | null;
  /** The signed-in ACCOUNT (`getNodeIdentity().accountId`), never a key. */
  selfAccount?: string | null;
  /**
   * Whether the signed-in member may change roles and remove people. Defaults
   * to "their own row says Admin". Pass it when the app knows more, such as a
   * MANAGE_MEMBERS capability.
   */
  canManage?: boolean;
  title?: string;
  description?: ReactNode;
  /** Shows an Invite button in the header that calls this. */
  onInvite?: () => void;
  /** Whether the Invite button is enabled. Defaults to `canManage`. */
  canInvite?: boolean;
  inviteLabel?: string;
  /** Rendered in the header instead of the Invite button: an app's own. */
  inviteSlot?: ReactNode;
  /** A name the app holds for an account, used when the namespace has none. */
  appName?: (account: string) => string | null | undefined;
  /**
   * After a role change the node accepted, for what the app keeps in step with
   * it (document access, a capability mask). Its failure is shown, but the
   * role change stands: it has already happened.
   */
  onRoleChanged?: (account: string, role: MemberRole) => Promise<void> | void;
  /** After a removal the node accepted. Same contract as `onRoleChanged`. */
  onRemoved?: (account: string) => Promise<void> | void;
  className?: string;
}

const TEE_TITLE =
  "A hardware-attested node keeps this workspace in sync and available when members are offline.";

function describe(err: unknown): string {
  const e = err as { explanation?: unknown; message?: unknown } | null;
  if (typeof e?.explanation === "string" && e.explanation) return e.explanation;
  if (typeof e?.message === "string" && e.message) return e.message;
  return String(err);
}

/**
 * Who is in a workspace, what role each holds, and, for an admin, the two
 * things an admin does with that list: change a role and remove someone.
 *
 * Everyone sees the list; only someone who may manage members gets controls.
 * Knowing who is in a workspace is useful without the right to change it.
 */
export function MembersPanel({
  admin,
  groupId,
  namespaceId,
  selfAccount,
  canManage: canManageProp,
  title = "Members",
  description,
  onInvite,
  canInvite,
  inviteLabel = "Invite",
  inviteSlot,
  appName,
  onRoleChanged,
  onRemoved,
  className,
}: MembersPanelProps) {
  const roster = useWorkspaceMembers(admin, groupId);
  const { displayName } = useMemberNames(admin, namespaceId ?? groupId);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The self-demotion waiting for a second click, if any.
  const [confirmDemote, setConfirmDemote] = useState(false);

  const selfRow = roster.members.find((m) => sameAccount(m.identity, selfAccount));
  const canManage = canManageProp ?? isAdminRole(selfRow?.role);
  const adminCount = useMemo(() => countAdmins(roster.members), [roster.members]);
  const teeMode = roster.teeMembers.some((m) => m.role === "RelayTee") ? "Relay" : "Replica";

  const nameOf = (m: WorkspaceMember) => displayName(m.identity, appName?.(m.identity) ?? m.name);

  async function applyRole(m: WorkspaceMember, next: MemberRole) {
    setBusy(m.identity);
    setError(null);
    setNotice(null);
    setConfirmDemote(false);
    try {
      await roster.setRole(m.identity, next);
    } catch (err) {
      setError(`Couldn't change ${nameOf(m)}'s role: ${describe(err)}`);
      setBusy(null);
      return;
    }
    try {
      await onRoleChanged?.(m.identity, next);
    } catch (err) {
      setNotice(`${nameOf(m)} is now ${next === "Admin" ? "an admin" : "a member"}, but: ${describe(err)}`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(m: WorkspaceMember) {
    setBusy(m.identity);
    setError(null);
    setNotice(null);
    try {
      await roster.remove(m.identity);
    } catch (err) {
      setError(`Couldn't remove ${nameOf(m)}: ${describe(err)}`);
      setBusy(null);
      return;
    }
    try {
      await onRemoved?.(m.identity);
    } catch (err) {
      setNotice(`Removed ${nameOf(m)}, but: ${describe(err)}`);
    } finally {
      setBusy(null);
    }
  }

  const count = roster.members.length;

  return (
    <section className={["cm-members", className].filter(Boolean).join(" ")} aria-label={title}>
      <header className="cm-members__head">
        <div className="cm-members__titles">
          <h3 className="cm-members__title">
            {title}
            {count > 0 ? ` (${count})` : ""}
          </h3>
          {roster.teeMembers.length > 0 && (
            <span className="cm-members__tee glass-pill" title={TEE_TITLE} data-testid="members-tee">
              TEE enabled · {teeMode}
            </span>
          )}
          {description && <p className="cm-members__desc">{description}</p>}
        </div>
        {inviteSlot ??
          (onInvite && (
            <button
              type="button"
              className="cm-btn cm-btn--primary"
              onClick={onInvite}
              disabled={!(canInvite ?? canManage)}
              title={(canInvite ?? canManage) ? undefined : "Only an admin can invite people."}
            >
              {inviteLabel}
            </button>
          ))}
      </header>

      {roster.error && (
        <p className="cm-members__error" role="alert">
          Couldn't load members: {describe(roster.error)}{" "}
          <button type="button" className="cm-btn" onClick={() => void roster.refetch()}>
            Retry
          </button>
        </p>
      )}
      {error && (
        <p className="cm-members__error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="cm-members__notice" role="status">
          {notice}
        </p>
      )}

      {roster.loading && count === 0 ? (
        <p className="cm-members__empty">Loading members…</p>
      ) : count === 0 && !roster.error ? (
        <p className="cm-members__empty">No members yet.</p>
      ) : (
        <ul className="cm-members__list">
          {roster.members.map((m) => {
            const isSelf = sameAccount(m.identity, selfAccount);
            const label = nameOf(m);
            const role = memberRoleOf(m.role);
            const rowBusy = busy === m.identity;
            const removal = canRemoveMember({ canManage, isSelf, role: m.role, adminCount });
            const vetoFor = (next: MemberRole) =>
              canChangeRole({ canManage, isSelf, currentRole: m.role, nextRole: next, adminCount });
            const otherRole: MemberRole = role === "Admin" ? "Member" : "Admin";
            const selectable = canManage && role !== null && vetoFor(otherRole).allowed;
            return (
              <li
                key={m.identity}
                className="cm-members__row"
                data-testid="member-row"
                data-account={m.identity}
              >
                <span className="cm-members__who">
                  <span className="cm-members__name" title={m.identity}>
                    {label}
                  </span>
                  {isSelf && <span className="cm-members__you">you</span>}
                  <code className="cm-members__id">{shortAccount(m.identity)}</code>
                </span>

                <span className="cm-members__actions">
                  {canManage && role !== null ? (
                    <select
                      className="cm-select"
                      aria-label={`Role for ${label}`}
                      value={role}
                      disabled={rowBusy || !selectable}
                      title={selectable ? undefined : vetoFor(otherRole).reason}
                      onChange={(e) => {
                        const next = e.target.value as MemberRole;
                        if (next === role) return;
                        if (isSelf && role === "Admin") {
                          setConfirmDemote(true);
                          return;
                        }
                        void applyRole(m, next);
                      }}
                    >
                      {MEMBER_ROLES.map((r) => (
                        <option key={r} value={r} disabled={r !== role && !vetoFor(r).allowed}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`cm-role glass-pill${isAdminRole(m.role) ? " cm-role--admin" : ""}`}
                      data-testid="member-role"
                    >
                      {roleLabel(m.role)}
                    </span>
                  )}

                  {removal.allowed && (
                    <RemoveMemberButton
                      label={label}
                      disabled={rowBusy}
                      prompt={`Remove ${label} from this workspace?`}
                      onConfirm={() => remove(m)}
                    />
                  )}
                </span>

                {isSelf && confirmDemote && (
                  <span className="cm-confirm cm-members__wide" role="group" aria-label="Confirm giving up admin">
                    <span className="cm-confirm__text">
                      Give up admin? Only another admin can make you one again.
                    </span>
                    <button
                      type="button"
                      className="cm-btn cm-btn--danger-solid"
                      onClick={() => void applyRole(m, "Member")}
                    >
                      Make me a member
                    </button>
                    <button type="button" className="cm-btn" onClick={() => setConfirmDemote(false)}>
                      Cancel
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
