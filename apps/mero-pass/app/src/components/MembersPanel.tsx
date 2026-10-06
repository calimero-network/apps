import { useCallback, useEffect, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';

import {
  canCreateVault,
  canInvite,
  canManageMembers,
  missingForRole,
  roleLabel,
  satisfiesRole,
} from '../lib/roles';
import type { TeamRole } from '../lib/roles';
import {
  listTeamMembers,
  removeTeamMember,
  setMemberRole,
} from '../lib/vaults';
import type { TeamMember } from '../lib/vaults';
import styles from '../styles/shell.module.css';
import {
  AlertTriangleIcon,
  ChevronRightIcon,
  InfoIcon,
  RefreshIcon,
} from './icons';
import { describeError } from '../lib/errors';

/**
 * Who is in a team, what they may do, and the controls to change it.
 *
 * ── The two things this panel refuses to conflate ────────────────────────────
 *
 * A row shows the ROLE the node recorded and, separately, whether the
 * CAPABILITIES behind it actually landed. They are set by different calls and
 * can disagree; when they do the row says so rather than rendering "Admin" over
 * somebody every admin endpoint refuses. A grant is published as an op and
 * PROJECTED a moment later, so "not applied yet" is a real, temporary state and
 * is reported as the list of missing bits rather than as a failure.
 *
 * Restyled onto the shared shell: rows on #e0e0e0 hairlines with the one button
 * system, instead of the mero-ui `Card` + `Badge` + `Alert` stack it was, which
 * brought three more button variants onto a screen that already had three.
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
  // `admin`, never `mero.admin`: on an account the raw client's admin is the
  // relay's node route and refuses every call here. See `lib/vaults`.
  const { admin } = useMero();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const iMayManage = canManageMembers(myCapabilities);

  const load = useCallback(async () => {
    if (!admin) return;
    setLoading(true);
    try {
      setMembers(await listTeamMembers(admin, namespaceId, myAccountId));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [admin, namespaceId, myAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (member: TeamMember, role: TeamRole) => {
      if (!admin) return;
      setError(null);
      setNotice(null);
      setConfirming(null);
      try {
        const result = await setMemberRole(
          admin,
          { namespaceId, accountId: member.accountId, role },
          setBusy,
        );
        setNotice(
          result.effective
            ? `${member.name} is now ${roleLabel(role)} — the node confirms the capabilities that go with it.`
            : `${member.name}'s role is now ${roleLabel(role)}, but the node has not applied ${result.missing.join(', ')} yet. Re-check in a moment; if it persists, the change did not take.`,
        );
        await load();
        onRolesChanged();
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [admin, namespaceId, load, onRolesChanged],
  );

  const remove = useCallback(
    async (member: TeamMember) => {
      if (!admin) return;
      setError(null);
      setNotice(null);
      setRemoving(null);
      setBusy(`Removing ${member.name}…`);
      try {
        await removeTeamMember(admin, {
          namespaceId,
          accountId: member.accountId,
        });
        setNotice(
          `${member.name} is out of ${teamName}. Each vault's key is rotated the next time one of its Admins opens it, and nothing written after that is readable to them. What they already saw cannot be taken back — change those passwords.`,
        );
        await load();
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [admin, namespaceId, teamName, load],
  );

  return (
    <section data-testid="members-panel">
      <div className={styles.sectionHead} style={{ marginTop: 0 }}>
        <div>
          <h2 className={styles.sectionTitle}>
            People
            {!loading && members.length > 0 && (
              <span className={styles.count}>{members.length}</span>
            )}
          </h2>
          <p className={styles.sectionHint}>
            An <strong>Admin</strong> can create vaults, invite people and
            change roles. A <strong>Member</strong> can open every open vault in{' '}
            {teamName}; what they may do inside a vault — view or edit — is set
            on that vault's People tab. Removing someone here also removes them
            from every vault, and rotates each vault's key the next time its
            Admin opens it.
          </p>
        </div>
        <button
          type="button"
          className={`${styles.btnGhost} ${styles.btnSm}`}
          onClick={() => void load()}
        >
          <RefreshIcon size={14} />
          Refresh
        </button>
      </div>

      {error && (
        <p className={styles.error} data-testid="members-error">
          <AlertTriangleIcon size={16} />
          <span>{error}</span>
        </p>
      )}
      {notice && (
        <p className={styles.notice} data-testid="members-notice">
          {notice}
        </p>
      )}
      {busy && (
        <p className={styles.status}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>{busy}</span>
        </p>
      )}
      {!iMayManage && !loading && (
        <p className={styles.status} data-testid="read-only-roles">
          <InfoIcon size={16} />
          <span>You are a Member, so the roles below are read-only.</span>
        </p>
      )}

      {/* ⚠️ The honest sentence, kept on screen rather than hidden in a
          confirmation nobody reads twice. Demotion is not revocation and must
          not be sold as one. */}
      {confirming && (
        <p className={styles.warn} data-testid="role-warning">
          <AlertTriangleIcon size={16} />
          <span>
            {members.find((m) => m.accountId === confirming)?.role === 'admin'
              ? 'Demoting stops them creating vaults, inviting people and changing roles. It does NOT remove them from the team — use Remove for that.'
              : 'Promoting lets them create vaults, invite anyone into this team and change roles, including yours.'}
          </span>
        </p>
      )}

      {loading ? (
        <p className={styles.status}>
          <span className={styles.spinner} aria-hidden="true" />
          <span>Loading people…</span>
        </p>
      ) : members.length === 0 ? (
        <p className={styles.empty} data-testid="members-empty">
          Nobody else is in this team yet. Use Invite to add someone.
        </p>
      ) : (
        <div className={styles.list} data-testid="member-list">
          {members.map((member) => {
            const mismatched = !satisfiesRole(member.capabilities, member.role);
            const target: TeamRole =
              member.role === 'admin' ? 'member' : 'admin';
            return (
              <div
                key={member.accountId}
                className={styles.row}
                data-testid="member-row"
              >
                <span className={styles.rowIcon} aria-hidden="true">
                  {initialsOf(member.name)}
                </span>
                <div className={styles.rowMain}>
                  <div className={styles.rowName}>
                    {member.name}
                    {member.isSelf && <span className={styles.you}>(you)</span>}
                    <span
                      className={`${styles.badge} ${member.role === 'admin' ? styles.badgeAccent : ''}`}
                    >
                      {roleLabel(member.role)}
                    </span>
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
                  {mismatched && (
                    <div
                      className={`${styles.badge} ${styles.badgeWarn}`}
                      style={{
                        height: 'auto',
                        padding: '4px 10px',
                        marginTop: 6,
                        whiteSpace: 'normal',
                        borderRadius: 8,
                        textTransform: 'none',
                      }}
                      data-testid="role-mismatch"
                    >
                      Recorded as {roleLabel(member.role)}, but the node has not
                      applied{' '}
                      {missingForRole(member.capabilities, member.role).join(
                        ', ',
                      )}{' '}
                      — they cannot use it until it does.
                    </div>
                  )}
                  <details className={styles.details}>
                    <summary>
                      <ChevronRightIcon size={12} />
                      Details
                    </summary>
                    <dl className={styles.detailsBody}>
                      <dt>Account</dt>
                      <dd>{member.accountId}</dd>
                    </dl>
                  </details>
                </div>

                {iMayManage && (
                  <div className={styles.rowActions}>
                    {confirming === member.accountId ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.btnGhost} ${styles.btnSm}`}
                          onClick={() => setConfirming(null)}
                          disabled={!!busy}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={`${
                            target === 'member' ? styles.btnDanger : styles.btn
                          } ${styles.btnSm}`}
                          onClick={() => void change(member, target)}
                          disabled={!!busy}
                          data-testid="role-confirm"
                        >
                          {target === 'member' ? 'Demote' : 'Promote'}
                        </button>
                      </>
                    ) : removing === member.accountId ? (
                      <>
                        <button
                          type="button"
                          className={`${styles.btnGhost} ${styles.btnSm}`}
                          onClick={() => setRemoving(null)}
                          disabled={!!busy}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={`${styles.btnDanger} ${styles.btnSm}`}
                          onClick={() => void remove(member)}
                          disabled={!!busy}
                          data-testid="member-remove-confirm"
                        >
                          Remove from team
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={`${styles.btnGhost} ${styles.btnSm}`}
                          onClick={() => setConfirming(member.accountId)}
                          disabled={!!busy}
                          data-testid="role-change"
                        >
                          {member.role === 'admin' ? 'Demote' : 'Promote'}
                        </button>
                        {!member.isSelf && (
                          <button
                            type="button"
                            className={`${styles.btnDanger} ${styles.btnSm}`}
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
    </section>
  );
}

/** Two letters for a member's avatar. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + second).toUpperCase();
}
