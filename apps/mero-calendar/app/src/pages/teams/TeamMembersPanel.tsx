import { useCallback, useEffect, useState } from "react";
import { RemoveMemberButton, canChangeRole, canRemoveMember } from "@calimero-apps/members";
import "@calimero-apps/members/members.css";

import { messageOf } from "../../api/calendar";
import { useSignedIn } from "../../api/sessionContext";
import { PRODUCT_NAME, isAdmin, readOrg, removeTeamMember } from "../../api/teams";
import { useToast } from "../../contexts/ToastContext";
import { CloseIcon, ShieldIcon, UserIcon } from "../../components/common/icons/Icons";
import styles from "./teams.module.scss";
import { passkeyConfirm } from "@calimero-network/mero-js";

interface Props {
  teamId: string;
  onClose: () => void;
  /** After a change, so the page re-reads what the change may have altered. */
  onChanged?: () => void;
}

interface Row {
  account: string;
  name: string;
  /** The org role: `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** The two roles this panel moves people between. */
type Role = "admin" | "member";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  guest: "Guest",
};

const labelOf = (role: string) => ROLE_LABEL[role] ?? role;
const short = (account: string) => (account.length > 16 ? `${account.slice(0, 16)}…` : account);

/**
 * The people in a team (an org): their names and roles, and for the team's
 * owner and admins, promoting, demoting and removing them. Every change is a
 * passkey step-up.
 *
 * v1 kept an Admin/Member core role plus a capability mask per member; the
 * org has roles (owner, admin, member, guest) and the members' default
 * capabilities, set when the team was made (`api/teams`'s `MEMBER_DEFAULTS`:
 * create calendars, invite).
 */
export default function TeamMembersPanel({ teamId, onClose, onChanged }: Props) {
  const { showToast } = useToast();
  const { client, accountId: me, passkey, source, after } = useSignedIn();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const org = await readOrg(client, teamId, source);
      setRows(
        // Who has Mero Calendar in the team (its app team, else the org), with their org role.
        org.people
          .map((account) => ({ account, role: org.roles.get(account) ?? "member", name: org.names.get(account) ?? "" }))
          .sort((a, b) => (a.account === me ? -1 : b.account === me ? 1 : a.account.localeCompare(b.account))),
      );
    } catch (err) {
      showToast(`Could not load the members: ${messageOf(err)}`);
      setRows([]);
    } finally {
      setLoading(false);
      after();
    }
  }, [client, teamId, me, source, showToast, after]);

  useEffect(() => {
    void load();
  }, [load]);

  const display = (row: Row) => row.name || short(row.account);
  const myRole = rows.find((r) => r.account === me)?.role;
  const canManage = isAdmin(myRole);
  // The owner is an admin that cannot be demoted here; counted as one.
  const adminCount = rows.filter((r) => isAdmin(r.role)).length;

  async function changeRole(row: Row, next: Role) {
    if (row.role === next) return;
    const verdict = canChangeRole({
      canManage,
      isSelf: row.account === me,
      currentRole: row.role === "admin" ? "Admin" : "Member",
      nextRole: next === "admin" ? "Admin" : "Member",
      adminCount,
    });
    if (!verdict.allowed) {
      showToast(verdict.reason ?? "That change is not allowed.");
      return;
    }
    setBusy(row.account);
    try {
      await client.orgs.setMember(
        { org: teamId, account: row.account, role: next },
        { confirm: passkeyConfirm(passkey()) },
      );
      showToast(
        next === "admin"
          ? `${display(row)} can now manage members and delete calendars.`
          : `${display(row)} is a member again.`,
        "success",
      );
      onChanged?.();
    } catch (err) {
      showToast(`Could not change that role: ${messageOf(err)}`);
    } finally {
      after();
      await load();
      setBusy(null);
    }
  }

  async function removeMember(row: Row) {
    setBusy(row.account);
    try {
      const left = await removeTeamMember(client, teamId, source, row.account, passkey);
      showToast(
        left === "app"
          ? `${display(row)} was removed from ${PRODUCT_NAME}. They stay in the organization and its other apps.`
          : `${display(row)} was removed from the team.`,
        "success",
      );
      onChanged?.();
      await load();
    } catch (err) {
      showToast(`Could not remove that member: ${messageOf(err)}`);
    } finally {
      after();
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
          Everyone in the team can create calendars and invite people. Admins also
          manage members and delete calendars.
        </p>

        {loading && rows.length === 0 ? (
          <p className={styles.empty}>Loading members…</p>
        ) : rows.length === 0 ? (
          <p className={styles.empty} data-testid="members-empty">
            No members to show.
          </p>
        ) : (
          <ul className={styles.memberList}>
            {rows.map((row) => {
              const isMe = row.account === me;
              const movable = row.role === "admin" || row.role === "member";
              return (
                <li className={styles.memberRow} key={row.account} data-testid={`member-${row.account}`}>
                  <span className={styles.memberIcon}>{isAdmin(row.role) ? <ShieldIcon /> : <UserIcon />}</span>
                  <span className={styles.memberInfo}>
                    <span className={styles.memberName}>
                      {display(row)}
                      {isMe && <span className={styles.memberYou}>you</span>}
                    </span>
                    <code className={styles.memberId}>{short(row.account)}</code>
                  </span>

                  {canManage && !isMe && movable ? (
                    <select
                      className={styles.memberRole}
                      value={row.role}
                      disabled={busy === row.account}
                      onChange={(e) => void changeRole(row, e.target.value as Role)}
                      aria-label={`Role for ${display(row)}`}
                      data-testid={`role-${row.account}`}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  ) : (
                    <span
                      className={styles.memberRole}
                      data-testid={`role-badge-${row.account}`}
                      title={isMe ? "Another admin has to change your role." : "Only a team admin can change roles."}
                    >
                      {labelOf(row.role)}
                    </span>
                  )}
                  {row.role !== "owner" &&
                    canRemoveMember({
                      canManage,
                      isSelf: isMe,
                      role: row.role,
                      adminCount,
                    }).allowed && (
                      <RemoveMemberButton
                        label={display(row)}
                        disabled={busy === row.account}
                        prompt={`Remove ${display(row)} from the team?`}
                        onConfirm={() => void removeMember(row)}
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
