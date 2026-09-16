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
 */
import { useCallback, useEffect, useState } from "react";

import {
  getMemberCapabilities,
  listGroupMembers,
  setMemberCapabilities,
  type GroupMemberRow,
} from "../../api/rpc";
import { accountId } from "../../api/identity";
import { capabilitiesFor, roleLabel, roleOf, type Role } from "../../api/roles";
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
  role: Role;
}

export default function TeamMembersPanel({ teamId, onClose }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const me = accountId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const members = await listGroupMembers(teamId);
      // Capabilities are a per-member read, so they are fetched together rather
      // than one after another — a ten-person team would otherwise spend ten
      // round-trips before the list appears.
      const withCaps = await Promise.all(
        members.map(async (m) => {
          let capabilities = 0;
          try {
            capabilities = await getMemberCapabilities(teamId, m.identity);
          } catch {
            /* unreadable capabilities read as none, never as admin */
          }
          return { ...m, capabilities, role: roleOf(capabilities) };
        }),
      );
      setRows(withCaps);
    } catch (err) {
      showToast(
        humanizeError(extractErrorMessage(err, "Could not load the members.")),
      );
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [teamId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function changeRole(row: Row, next: Role) {
    if (row.role === next) return;
    setBusy(row.identity);
    // Re-read rather than trusting the row: capabilities are governance state
    // another admin may have changed since this list was drawn, and
    // `capabilitiesFor` preserves every bit it does not speak for — which only
    // works if it is handed the CURRENT mask.
    try {
      let current = row.capabilities;
      try {
        current = await getMemberCapabilities(teamId, row.identity);
      } catch {
        /* fall back to what the list already had */
      }
      await setMemberCapabilities(
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
      await load();
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
              const isMe = Boolean(me) && me === row.identity;
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
                      {row.name?.trim() || `${row.identity.slice(0, 10)}…`}
                      {isMe && <span className={styles.memberYou}>you</span>}
                    </span>
                    <code className={styles.memberId}>
                      {row.identity.slice(0, 16)}…
                    </code>
                  </span>

                  <select
                    className={styles.memberRole}
                    value={row.role}
                    disabled={busy === row.identity}
                    onChange={(e) => changeRole(row, e.target.value as Role)}
                    aria-label={`Role for ${row.name ?? row.identity}`}
                    data-testid={`role-${row.identity}`}
                  >
                    <option value="member">{roleLabel("member")}</option>
                    <option value="admin">{roleLabel("admin")}</option>
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function short(row: GroupMemberRow): string {
  return row.name?.trim() || `${row.identity.slice(0, 10)}…`;
}
