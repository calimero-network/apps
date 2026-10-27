/**
 * Who is in the team, and what they may do in it.
 *
 * ⚠️ Why this page exists: a team member could not create a calendar. Creating
 * a context inside a namespace needs `CAN_CREATE_CONTEXT`, which only the
 * team's creator held, and the app had no screen anywhere that could grant it —
 * so "invite a colleague and let them start a calendar" was simply impossible,
 * and the node's refusal surfaced as a generic error with nothing to do about
 * it.
 *
 * The two roles are defined in `api/roles`. Admin also carries
 * `CAN_MANAGE_METADATA`, because a member who can create a calendar but cannot
 * publish its name would make calendars that show up as raw ids on everyone
 * else's node.
 *
 * ⚠️ A role change moves the CORE role (`updateMemberRole`) and keeps the
 * capability mask in step with it. It used to write only the mask, which made
 * somebody an "Admin" here whom the node still treated as a plain member, and
 * there was no way to remove anybody at all.
 */
import { useCallback, useEffect, useState } from "react";
import { useMero } from "@calimero-apps/cloud";
import { sameAccount, useMemberNames } from "@calimero-apps/names";
import {
  RemoveMemberButton,
  canChangeRole,
  canRemoveMember,
  isAdminRole,
} from "@calimero-apps/members";
import "@calimero-apps/members/members.css";

import {
  fallbackCapabilities,
  getMemberCapabilities,
  listGroupMembers,
  removeGroupMembers,
  setMemberCapabilities,
  updateMemberRole,
  type GroupMemberRow,
} from "../../api/admin";
import { accountId } from "../../api/identity";
import {
  ADMIN_CAPABILITIES,
  MANAGE_MEMBERS,
  capabilitiesFor,
  roleLabel,
  roleOf,
  type Role,
} from "../../api/roles";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import { CloseIcon, ShieldIcon, UserIcon } from "../../components/common/icons/Icons";
import styles from "./teams.module.scss";

interface Props {
  teamId: string;
  onClose: () => void;
}

interface Row extends GroupMemberRow {
  capabilities: number;
  /** The raw core role from the listing (Admin / Member / ReadOnly). */
  coreRole?: string;
  /** What this list shows: an admin by core role or by the full admin mask. */
  role: Role;
}

/** Core's own Admin, or a member who holds every admin bit, reads as Admin. */
function displayedRole(coreRole: string | undefined, capabilities: number): Role {
  return isAdminRole(coreRole) ? "admin" : roleOf(capabilities);
}

export default function TeamMembersPanel({ teamId, onClose }: Props) {
  const { showToast } = useToast();
  // `admin`, not `mero.admin`: the session-aware client, which on an account
  // governs through the relay as the account (see TeamsPage).
  const { admin } = useMero();
  // The name each person set on the team (namespace member metadata), shared
  // with every app on it — including one this session just published — and a
  // short id, never a raw prefix, for someone who never set one.
  const { displayName } = useMemberNames(admin, teamId);
  const short = (row: GroupMemberRow) => displayName(row.identity, row.name);
  const [rows, setRows] = useState<Row[]>([]);
  const [teeMembers, setTeeMembers] = useState<GroupMemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const me = accountId();

  const load = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    try {
      const { members, teeMembers } = await listGroupMembers(admin, teamId);
      setTeeMembers(teeMembers);
      // Capabilities are a per-member read, so they are fetched together rather
      // than one after another — a ten-person team would otherwise spend ten
      // round-trips before the list appears.
      const withCaps = await Promise.all(
        members.map(async (m) => {
          let capabilities = 0;
          try {
            capabilities = await getMemberCapabilities(admin, teamId, m.identity);
          } catch {
            // Unreadable capabilities read as what the member's ROW already
            // says (the group admin is an admin; everyone else holds the
            // group's defaults) — never as more than that.
            capabilities = await fallbackCapabilities(
              admin,
              teamId,
              m,
              ADMIN_CAPABILITIES,
            );
          }
          return {
            ...m,
            capabilities,
            coreRole: m.role,
            role: displayedRole(m.role, capabilities),
          };
        }),
      );
      setRows(withCaps);
    } catch (err) {
      showToast(
        humanizeError(extractErrorMessage(err, "Could not load the members.")),
      );
      setRows([]);
      setTeeMembers([]);
    } finally {
      setLoading(false);
    }
  }, [admin, teamId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const meRow = rows.find((r) => sameAccount(r.identity, me));
  // Whether the signed-in member may change roles and remove people: a core
  // Admin, or a member holding MANAGE_MEMBERS. Everyone else sees the list
  // read-only, because the node would refuse every write they could make.
  const canManage =
    !!meRow &&
    (isAdminRole(meRow.coreRole) ||
      (meRow.capabilities & MANAGE_MEMBERS) === MANAGE_MEMBERS);
  const adminCount = rows.filter((r) => r.role === "admin").length;

  async function changeRole(row: Row, next: Role) {
    if (row.role === next) return;
    const verdict = canChangeRole({
      canManage,
      isSelf: sameAccount(row.identity, me),
      currentRole: row.role === "admin" ? "Admin" : "Member",
      nextRole: next === "admin" ? "Admin" : "Member",
      adminCount,
    });
    if (!verdict.allowed) {
      showToast(verdict.reason ?? "That change is not allowed.");
      return;
    }
    setBusy(row.identity);
    try {
      if (!admin) throw new Error("Not connected.");
      // The core role first: it is the change itself, and if the node refuses
      // it nothing else should move.
      const coreNext = next === "admin" ? "Admin" : "Member";
      if (isAdminRole(row.coreRole) !== (coreNext === "Admin")) {
        await updateMemberRole(admin, teamId, row.identity, coreNext);
      }
    } catch (err) {
      // ⚠️ The node's own reason AND the hint, not one or the other.
      // `extractErrorMessage` prefers the error's message over the fallback, so
      // passing the guidance as the fallback meant it was only ever shown when
      // the node said NOTHING — and the refusal a user actually hits arrives as
      // a bare "forbidden", which does not tell them a team admin has to do it.
      const reason = humanizeError(
        extractErrorMessage(err, "Could not change that role."),
      );
      showToast(`${reason} Only a team admin can change roles.`);
      setBusy(null);
      return;
    }
    // Then the mask. Re-read rather than trusting the row: capabilities are
    // governance state another admin may have changed since this list was
    // drawn, and `capabilitiesFor` preserves every bit it does not speak for —
    // which only works if it is handed the CURRENT mask. A demotion that left
    // the admin bits behind would leave the member able to do everything.
    try {
      let current = row.capabilities;
      try {
        current = await getMemberCapabilities(admin, teamId, row.identity);
      } catch {
        /* fall back to what the list already had */
      }
      await setMemberCapabilities(
        admin,
        teamId,
        row.identity,
        capabilitiesFor(next, current),
      );
      showToast(
        next === "admin"
          ? `${short(row)} can now create calendars and manage members.`
          : `${short(row)} is a member again.`,
        "success",
      );
    } catch (err) {
      const reason = humanizeError(
        extractErrorMessage(err, "Could not update their permissions."),
      );
      showToast(
        `${short(row)} is now ${next === "admin" ? "an admin" : "a member"}, but their permissions did not follow: ${reason}`,
      );
    } finally {
      await load();
      setBusy(null);
    }
  }

  async function removeMember(row: Row) {
    setBusy(row.identity);
    try {
      if (!admin) throw new Error("Not connected.");
      await removeGroupMembers(admin, teamId, [row.identity]);
      showToast(`${short(row)} was removed from the team.`, "success");
      await load();
    } catch (err) {
      const reason = humanizeError(
        extractErrorMessage(err, "Could not remove that member."),
      );
      showToast(`${reason} Only a team admin can remove members.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mc-overlay" onClick={onClose} data-testid="members-panel">
      <div
        className={styles.membersPanel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Team members"
      >
        <header className={styles.membersHead}>
          <h2 className={styles.membersTitle}>Members</h2>
          {teeMembers.length > 0 && (
            <span
              className={styles.teeBadge}
              title="A hardware-attested node keeps this workspace in sync and available when members are offline."
              data-testid="tee-enabled"
            >
              <ShieldIcon />
              TEE enabled
              <span className={styles.teeMode}>
                {teeMembers.some((m) => m.role === "RelayTee")
                  ? "Relay"
                  : "Replica"}
              </span>
            </span>
          )}
          <button
            className={styles.membersClose}
            onClick={onClose}
            aria-label="Close"
            data-testid="members-close"
          >
            <CloseIcon />
          </button>
        </header>

        <p className={styles.membersHint}>
          Admins can create calendars in this team, name them for everyone, and
          invite or promote other people.
        </p>

        {loading ? (
          <p className={styles.empty}>Loading members…</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty} data-testid="members-empty">
            No members to show.
          </p>
        ) : (
          <ul className={styles.memberList}>
            {rows.map((row) => {
              const isMe = sameAccount(row.identity, me);
              return (
                <li
                  className={styles.memberRow}
                  key={row.identity}
                  data-testid={`member-${row.identity}`}
                >
                  <span className={styles.memberIcon}>
                    {row.role === "admin" ? <ShieldIcon /> : <UserIcon />}
                  </span>
                  <span className={styles.memberInfo}>
                    <span className={styles.memberName}>
                      {short(row)}
                      {isMe && <span className={styles.memberYou}>you</span>}
                    </span>
                    <code className={styles.memberId}>
                      {row.identity.slice(0, 16)}…
                    </code>
                  </span>

                  {canManage && !isMe ? (
                    <select
                      className={styles.memberRole}
                      value={row.role}
                      disabled={busy === row.identity}
                      onChange={(e) => changeRole(row, e.target.value as Role)}
                      aria-label={`Role for ${short(row)}`}
                      data-testid={`role-${row.identity}`}
                    >
                      <option value="member">{roleLabel("member")}</option>
                      <option value="admin">{roleLabel("admin")}</option>
                    </select>
                  ) : (
                    <span
                      className={styles.memberRole}
                      data-testid={`role-badge-${row.identity}`}
                      title={
                        isMe
                          ? "Another admin has to change your role."
                          : "Only a team admin can change roles."
                      }
                    >
                      {roleLabel(row.role)}
                    </span>
                  )}
                  {canRemoveMember({
                    canManage,
                    isSelf: isMe,
                    role: row.role === "admin" ? "Admin" : "Member",
                    adminCount,
                  }).allowed && (
                    <RemoveMemberButton
                      label={short(row)}
                      disabled={busy === row.identity}
                      prompt={`Remove ${short(row)} from the team?`}
                      onConfirm={() => removeMember(row)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
