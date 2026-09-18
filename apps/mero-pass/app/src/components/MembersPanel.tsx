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
import { listTeamMembers, setMemberRole } from '../lib/vaults';
import type { TeamMember } from '../lib/vaults';
import styles from '../styles/shell.module.css';

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
  const { mero } = useMero();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const iMayManage = canManageMembers(myCapabilities);

  const load = useCallback(async () => {
    if (!mero) return;
    setLoading(true);
    try {
      setMembers(await listTeamMembers(mero.admin, namespaceId, myAccountId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, namespaceId, myAccountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const change = useCallback(
    async (member: TeamMember, role: TeamRole) => {
      if (!mero) return;
      setError(null);
      setNotice(null);
      setConfirming(null);
      try {
        const result = await setMemberRole(
          mero.admin,
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
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, namespaceId, load, onRolesChanged],
  );

  return (
    <section data-testid="members-panel">
      <p className={styles.sectionHint}>
        An <strong>Admin</strong> can create vaults, invite people and change
        roles. A <strong>Member</strong> can open every vault in {teamName} and
        read and write its secrets — which is what they were invited for.
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

      {loading ? (
        <p className={styles.empty}>Loading people…</p>
      ) : members.length === 0 ? (
        <p className={styles.empty} data-testid="members-empty">
          Nobody else is in this team yet. Use Invite to add someone.
        </p>
      ) : (
        <div data-testid="member-list">
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
                <div className={styles.rowMain}>
                  <div className={styles.rowName}>
                    {member.name}
                    {member.isSelf ? ' (you)' : ''}{' '}
                    <span
                      className={`${styles.badge} ${member.role === 'admin' ? styles.badgeAccent : ''}`}
                    >
                      {roleLabel(member.role)}
                    </span>
                  </div>
                  <div className={styles.mono}>
                    {member.accountId.slice(0, 16)}…
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
                    <div className={styles.rowSub} data-testid="role-mismatch">
                      Recorded as {roleLabel(member.role)}, but the node has not
                      applied{' '}
                      {missingForRole(member.capabilities, member.role).join(
                        ', ',
                      )}{' '}
                      — they cannot use it until it does.
                    </div>
                  )}
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
                    ) : (
                      <button
                        type="button"
                        className={styles.btnGhost}
                        onClick={() => setConfirming(member.accountId)}
                        disabled={!!busy}
                        data-testid="role-change"
                      >
                        {member.role === 'admin' ? 'Demote' : 'Promote'}
                      </button>
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
            ? 'Demoting stops them creating vaults, inviting people and changing roles. It does NOT remove them from the team, they keep read and write on every vault here, and it cannot un-sync secrets their node has already copied — to protect those, rotate them.'
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
