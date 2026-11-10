import { useCallback, useEffect, useMemo, useState } from 'react';

import { useCalimero } from '../calimero';
import { publishMemberName, shortAccount, useMemberNames } from '../lib/names';

import {
  canCreateVault,
  canInvite,
  canManageMembers,
  roleLabel,
} from '../lib/roles';
import type { TeamRole } from '../lib/roles';
import {
  listTeamMembers,
  removeTeamMember,
  setMemberRole,
} from '../lib/vaults';
import type { TeamMember } from '../lib/vaults';
import styles from '../styles/shell.module.css';
import { describeError } from '../lib/errors';

/**
 * Who is in a team (an organization), their role, and the controls to change
 * it. Role changes and removals are passkey step-ups on the node.
 */
export default function MembersPanel({
  namespaceId,
  teamName,
  myAccountId,
  myCapabilities,
  onRolesChanged,
}: {
  namespaceId: string;
  teamName: string;
  myAccountId: string | null;
  /** This node's own mask — what gates the controls below. */
  myCapabilities: number | null;
  /** Re-read the caller's own capabilities: demoting yourself is allowed. */
  onRolesChanged: () => void;
}) {
  const { client, passkey, source, after } = useCalimero();
  const conn = useMemo(
    () => (client ? { client, passkey, source, after } : null),
    [client, passkey, source, after],
  );
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [myName, setMyName] = useState('');

  const iMayManage = canManageMembers(myCapabilities);

  // The name each person set in the team (org member metadata).
  const { nameOf, refresh: refreshNames } = useMemberNames(client, namespaceId);
  const nameFor = useCallback(
    (member: TeamMember) => nameOf(member.accountId) ?? member.name,
    [nameOf],
  );
  const myCurrentName = myAccountId ? nameOf(myAccountId) : undefined;

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      setMembers(await listTeamMembers({ client, source }, namespaceId, myAccountId));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [client, source, namespaceId, myAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (member: TeamMember, role: TeamRole) => {
      if (!conn) return;
      setError(null);
      setNotice(null);
      setConfirming(null);
      setBusy('Confirm with your passkey…');
      try {
        await setMemberRole(conn, {
          namespaceId,
          accountId: member.accountId,
          role,
        });
        setNotice(`${nameFor(member)} is now ${roleLabel(role)}.`);
        await load();
        onRolesChanged();
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [conn, namespaceId, load, onRolesChanged, nameFor],
  );

  const remove = useCallback(
    async (member: TeamMember) => {
      if (!conn) return;
      setError(null);
      setNotice(null);
      setRemoving(null);
      const name = nameFor(member);
      setBusy(`Removing ${name}: confirm with your passkey…`);
      try {
        const left = await removeTeamMember(conn, {
          namespaceId,
          accountId: member.accountId,
        });
        setNotice(
          `${name} is out of ${left === 'app' ? `Mero Pass in ${teamName} (they stay in the organization and its other apps)` : teamName}. Each vault's key is rotated the next time one of its Admins opens it, and nothing written after that is readable to them. What they already saw cannot be taken back — change those passwords.`,
        );
        await load();
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [conn, namespaceId, teamName, load, nameFor],
  );

  /** Publish the name every app on this team shows for this account. */
  const saveMyName = useCallback(async () => {
    const trimmed = myName.trim();
    if (!client || !myAccountId || !trimmed) return;
    setError(null);
    setNotice(null);
    setBusy('Saving your name…');
    try {
      await publishMemberName(client, namespaceId, myAccountId, trimmed);
      refreshNames();
      setMyName('');
      setNotice(`Everyone in ${teamName} now sees you as ${trimmed}.`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, [client, namespaceId, myAccountId, myName, teamName, refreshNames]);

  return (
    <section data-testid="members-panel">
      <p className={styles.sectionHint}>
        An <strong>Admin</strong> can create vaults, invite people and change
        roles. A <strong>Member</strong> can open every open vault in {teamName}
        ; what they may do inside a vault — view or edit — is set on that
        vault's People tab. Removing someone here ends their access to every
        vault at once, and each vault's key is rotated the next time its Admin
        opens it.
      </p>

      {error && (
        <p className={styles.error} data-testid="members-error">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} data-testid="members-notice">
          {notice}
        </p>
      )}
      {busy && <p className={styles.status}>{busy}</p>}
      {!iMayManage && !loading && (
        <p className={styles.status} data-testid="read-only-roles">
          You are a Member, so the roles below are read-only.
        </p>
      )}

      {myAccountId && (
        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder={
              myCurrentName ?? 'Your name — how others in this team see you'
            }
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void saveMyName()}
            aria-label="Your name"
            data-testid="my-name"
          />
          <button
            type="button"
            className={styles.btn}
            onClick={() => void saveMyName()}
            disabled={!!busy || !myName.trim()}
            data-testid="my-name-save"
          >
            {myCurrentName ? 'Rename' : 'Set name'}
          </button>
        </div>
      )}

      {loading ? (
        <p className={styles.empty}>Loading people…</p>
      ) : members.length === 0 ? (
        <p className={styles.empty} data-testid="members-empty">
          Nobody else is in this team yet. Use Invite to add someone.
        </p>
      ) : (
        <div data-testid="member-list">
          {members.map((member) => {
            const target: TeamRole =
              member.role === 'admin' ? 'member' : 'admin';
            return (
              <div
                key={member.accountId}
                className={styles.row}
                data-testid="member-row"
              >
                <div className={styles.rowMain}>
                  <div className={styles.rowName}>
                    {nameFor(member)}
                    {member.isSelf ? ' (you)' : ''}{' '}
                    <span
                      className={`${styles.badge} ${member.role === 'admin' ? styles.badgeAccent : ''}`}
                    >
                      {roleLabel(member.role)}
                    </span>
                  </div>
                  <div className={styles.mono} title={member.accountId}>
                    {shortAccount(member.accountId)}
                  </div>
                  <div className={styles.rowSub}>
                    {canCreateVault(member.capabilities)
                      ? 'Can create vaults'
                      : 'Cannot create vaults'}
                    {' · '}
                    {canInvite(member.capabilities)
                      ? 'can invite'
                      : 'cannot invite'}
                    {' · '}
                    {canManageMembers(member.capabilities)
                      ? 'can change roles'
                      : 'cannot change roles'}
                  </div>
                </div>

                {iMayManage && (
                  <div className={styles.rowActions}>
                    {confirming === member.accountId ? (
                      <>
                        <button
                          type="button"
                          className={
                            target === 'member' ? styles.btnDanger : styles.btn
                          }
                          onClick={() => void change(member, target)}
                          disabled={!!busy}
                          data-testid="role-confirm"
                        >
                          {target === 'member' ? 'Demote' : 'Promote'}
                        </button>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => setConfirming(null)}
                          disabled={!!busy}
                        >
                          Cancel
                        </button>
                      </>
                    ) : removing === member.accountId ? (
                      <>
                        <button
                          type="button"
                          className={styles.btnDanger}
                          onClick={() => void remove(member)}
                          disabled={!!busy}
                          data-testid="member-remove-confirm"
                        >
                          Remove from team
                        </button>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => setRemoving(null)}
                          disabled={!!busy}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={styles.btnGhost}
                          onClick={() => setConfirming(member.accountId)}
                          disabled={!!busy}
                          data-testid="role-change"
                        >
                          {member.role === 'admin' ? 'Demote' : 'Promote'}
                        </button>
                        {!member.isSelf && (
                          <button
                            type="button"
                            className={styles.btnGhost}
                            onClick={() => setRemoving(member.accountId)}
                            disabled={!!busy}
                            data-testid="member-remove"
                          >
                            Remove
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ⚠️ The honest sentence, kept on screen rather than hidden in a
          confirmation nobody reads twice. Demotion is not revocation and must
          not be sold as one. */}
      {confirming && (
        <p className={styles.sectionHint} data-testid="role-warning">
          {members.find((m) => m.accountId === confirming)?.role === 'admin'
            ? 'Demoting stops them creating vaults, inviting people and changing roles. It does NOT remove them from the team — use Remove for that.'
            : 'Promoting lets them create vaults, invite anyone into this team and change roles, including yours.'}
        </p>
      )}

      <div className={styles.section}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>
    </section>
  );
}
