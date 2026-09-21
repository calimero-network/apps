import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import InviteModal from '../../components/InviteModal';
import MembersPanel from '../../components/MembersPanel';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useTeamCapabilities } from '../../hooks/useTeamCapabilities';
import { canCreateVault, canInvite } from '../../lib/roles';
import {
  createVault,
  displayName,
  enterVaultContext,
  listTeams,
  listVaults,
  mintTeamInvite,
  mintVaultInvite,
} from '../../lib/vaults';
import type { VaultRow } from '../../lib/vaults';
import styles from '../../styles/shell.module.css';
import { JoinSyncBanner, useJoinSync } from '@calimero-apps/join-sync';

type Tab = 'vaults' | 'people';

/**
 * One team: the vaults in it, and the people it is shared with.
 *
 * MeroDesign's Projects screen — a back link in the header, tabs on a 2px rule,
 * and a card grid — rather than the stack of mero-ui `Card`s with a heading,
 * three sub-headings and a members panel bolted underneath that was here.
 *
 * Both halves are gated on the caller's real CAPABILITY MASK, never on a role
 * string and never on "they opened the page", so a Member is not shown a button
 * the node will refuse.
 */
export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { mero } = useMero();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { appId, notInstalled } = useApplicationId();
  const {
    accountId,
    capabilities,
    loading: capsLoading,
    refetch: refetchCaps,
  } = useTeamCapabilities(teamId ?? null);

  const tab: Tab = params.get('tab') === 'people' ? 'people' : 'vaults';
  const setTab = (next: Tab) =>
    setParams(next === 'vaults' ? {} : { tab: next }, { replace: true });

  const [teamName, setTeamName] = useState('');
  const [vaults, setVaults] = useState<VaultRow[]>([]);
  const [loading, setLoading] = useState(true);
  /** The team whose vault list has come back at least once. */
  const [listedForTeam, setListedForTeam] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    code: string;
    scope: string;
    hint: string;
  } | null>(null);

  const mayCreateVault = canCreateVault(capabilities);
  const mayInvite = canInvite(capabilities);
  const heading = useMemo(
    () => (teamId ? displayName([teamName], teamId, 'Team') : 'Team'),
    [teamName, teamId],
  );

  // A team joined this session whose vaults have not replicated yet. Without
  // this a brand-new member is told "No vaults in this team yet" about a team
  // whose vaults are still on their way — and invited to create a duplicate.
  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: teamId ?? null,
    settled: !!teamId && listedForTeam === teamId,
  });

  const load = useCallback(async () => {
    if (!mero || !teamId) return;
    setLoading(true);
    try {
      setVaults(await listVaults(mero.admin, teamId));
      // A real answer, empty or not — that is what ends the sync gate.
      setListedForTeam(teamId);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, teamId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!mero || !appId || !teamId) return;
    let cancelled = false;
    listTeams(mero.admin, appId)
      .then((rows) => {
        if (!cancelled) {
          setTeamName(rows.find((r) => r.namespaceId === teamId)?.name ?? '');
        }
      })
      .catch(() => {
        if (!cancelled) setTeamName('');
      });
    return () => {
      cancelled = true;
    };
  }, [mero, appId, teamId]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!mero || !appId || !teamId || !name) return;
    setError(null);
    try {
      await createVault(
        mero.admin,
        { applicationId: appId, namespaceId: teamId, name },
        setBusy,
      );
      setNewName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, appId, teamId, newName, load]);

  const open = useCallback(
    async (vault: VaultRow) => {
      if (!mero || !vault.contextId) return;
      setError(null);
      try {
        await enterVaultContext(
          mero.admin,
          {
            vaultId: vault.vaultId,
            contextId: vault.contextId,
            // The team this vault belongs to. Inheritance eligibility is
            // decided against the PARENT, so this is the group whose state
            // the retry has to wait for — see `joinVaultWithRetry`.
            namespaceId: teamId,
          },
          setBusy,
        );
        navigate(`/vault/${vault.contextId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, navigate, teamId],
  );

  const inviteToTeam = useCallback(async () => {
    if (!mero || !teamId) return;
    setError(null);
    try {
      const code = await mintTeamInvite(
        mero.admin,
        { namespaceId: teamId, teamName: heading },
        setBusy,
      );
      setInvite({
        code,
        scope: `Whole team · ${heading}`,
        hint: 'Anyone who opens this link can join the team and read every vault in it.',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, teamId, heading]);

  const inviteToVault = useCallback(
    async (vault: VaultRow) => {
      if (!mero || !teamId) return;
      setError(null);
      try {
        const code = await mintVaultInvite(
          mero.admin,
          {
            namespaceId: teamId,
            vaultId: vault.vaultId,
            vaultName: vault.name,
            teamName: heading,
            contextId: vault.contextId,
          },
          setBusy,
        );
        setInvite({
          code,
          scope: `Opens ${vault.name}`,
          // Said plainly: vault access is INHERITED, so there is no such thing
          // as a vault-only grant and the UI must not imply one.
          hint: `This link lands them in “${vault.name}”, but the access it grants is the whole of ${heading} — every vault in the team, including ones added later.`,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero, teamId, heading],
  );

  return (
    <div className={styles.root}>
      <AppHeader back={{ label: 'Teams', to: '/teams' }} crumb={heading} />

      <main className={styles.mainWide}>
        <div className={styles.titleRow}>
          <div>
            <h1 className={styles.title} data-testid="team-heading">
              {heading}
            </h1>
            <p className={styles.subtitle}>
              Every vault here is shared with everyone in this team.
            </p>
          </div>
          {mayInvite && (
            <div className={styles.titleRowActions}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void inviteToTeam()}
                disabled={!!busy}
                data-testid="invite-team"
              >
                Invite
              </button>
            </div>
          )}
        </div>

        <div className={styles.tabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'vaults'}
            className={`${styles.tab} ${tab === 'vaults' ? styles.tabActive : ''}`}
            onClick={() => setTab('vaults')}
            data-testid="tab-vaults"
          >
            Vaults
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'people'}
            className={`${styles.tab} ${tab === 'people' ? styles.tabActive : ''}`}
            onClick={() => setTab('people')}
            data-testid="tab-people"
          >
            People
          </button>
        </div>

        {error && (
          <p className={styles.error} data-testid="error">
            {error}
          </p>
        )}
        {busy && <p className={styles.status}>{busy}</p>}

        {tab === 'vaults' ? (
          <>
            {mayCreateVault ? (
              <div className={styles.createRow}>
                <input
                  className={styles.input}
                  placeholder="New vault name — “Bank logins”, “Production keys”…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void create()}
                  data-testid="vault-name"
                />
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => void create()}
                  disabled={!mero || !appId || !newName.trim() || !!busy}
                  data-testid="vault-create"
                >
                  Create
                </button>
              </div>
            ) : (
              !capsLoading && (
                <p className={styles.status} data-testid="member-notice">
                  You are a Member of this team, so you can open every vault
                  below but not create new ones. An Admin can change that under
                  People.
                </p>
              )
            )}

            {notInstalled ? (
              <p className={styles.empty}>
                Mero Pass is not installed on this node.
              </p>
            ) : isSyncing ? (
              <JoinSyncBanner show what="vaults" onDismiss={dismissSyncing} />
            ) : loading ? (
              <p className={styles.empty}>Loading…</p>
            ) : vaults.length === 0 ? (
              <p className={styles.empty} data-testid="vaults-empty">
                No vaults in this team yet.
                {mayCreateVault
                  ? ' Create one above — everyone already in the team gets it.'
                  : ' An Admin can create the first one.'}
              </p>
            ) : (
              <div className={styles.gridWide} data-testid="vault-grid">
                {vaults.map((vault) => (
                  <div key={vault.vaultId} className={styles.cardWrap}>
                    <button
                      type="button"
                      className={`${styles.card} ${vault.joined ? styles.cardJoined : ''}`}
                      onClick={() => void open(vault)}
                      disabled={!vault.contextId || !!busy}
                      data-testid="vault-card"
                    >
                      <span className={styles.cardName}>{vault.name}</span>
                      <span className={styles.cardSub}>
                        {vault.memberCount} member
                        {vault.memberCount === 1 ? '' : 's'}
                        {vault.contextId
                          ? vault.joined
                            ? ' · you are in'
                            : ' · not joined'
                          : ' · syncing'}
                      </span>
                    </button>
                    {mayInvite && vault.contextId && (
                      <button
                        type="button"
                        className={styles.menuBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          void inviteToVault(vault);
                        }}
                        title={`Invite someone to ${vault.name}`}
                        aria-label={`Invite someone to ${vault.name}`}
                        data-testid="vault-invite"
                      >
                        ＋
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          teamId && (
            <MembersPanel
              namespaceId={teamId}
              teamName={heading}
              myAccountId={accountId}
              myCapabilities={capabilities}
              onRolesChanged={() => void refetchCaps()}
            />
          )
        )}
      </main>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint={invite?.hint}
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
