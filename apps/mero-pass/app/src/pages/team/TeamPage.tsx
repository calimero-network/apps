import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import AppShell from '../../components/AppShell';
import InviteModal from '../../components/InviteModal';
import MembersPanel from '../../components/MembersPanel';
import { PlusIcon } from '../../components/icons';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useTeamCapabilities } from '../../hooks/useTeamCapabilities';
import { hueOf, monogramOf } from '../../lib/itemView';
import { canCreateVault, canInvite } from '../../lib/roles';
import {
  DEFAULT_INVITE_SECS,
  INVITE_VALIDITY,
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
import {
  JOIN_SYNC_MAX_MS,
  JOIN_SYNC_POLL_MS,
  JoinSyncBanner,
  isNamespaceJustJoined,
  useJoinSync,
} from '@calimero-network/mero-react';
import { describeError } from '../../lib/errors';

type Tab = 'vaults' | 'people';

/**
 * One team: the vaults in it, and the people it is shared with.
 *
 * In the fleet's glass: the team's monogram tile and name, a segmented
 * Vaults / People control, the vaults as frosted cards with their facts as
 * chips, and "add a vault" as a panel under them.
 *
 * Both halves are gated on the caller's real CAPABILITY MASK, never on a role
 * string and never on "they opened the page", so a Member is not shown a button
 * the node will refuse.
 */
export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  // `admin`, never `mero.admin`: the session-aware client (see `lib/vaults`
  // `AdminLike`). `isDelegated` hides the two things an ACCOUNT cannot do yet:
  // a subgroup invitation has no account form in mero-react, so an invite-only
  // vault can neither be invited to nor, for an account, usefully created.
  const { admin, isDelegated } = useMero();
  const navigate = useNavigate();
  const location = useLocation();
  // Handed over by the teams screen right after `createTeam`: why the cloud
  // would not host this team, in words a person can act on. Only an account
  // founding through a relay ever has one.
  const hostingNotice =
    (location.state as { hostingNotice?: string } | null)?.hostingNotice ??
    null;
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
  const [restricted, setRestricted] = useState(false);
  const [validFor, setValidFor] = useState<number>(DEFAULT_INVITE_SECS);
  const validLabel =
    INVITE_VALIDITY.find((v) => v.secs === validFor)?.label ?? '24 hours';
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
  //
  // So an EMPTY list settles only once the team is no longer just-joined: until
  // then it is what a node that has not synced the team returns. The watchdog
  // clears the flag, after which a team with no vaults reads as empty again.
  const listed = !!teamId && listedForTeam === teamId;
  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: teamId ?? null,
    settled:
      listed && (vaults.length > 0 || !isNamespaceJustJoined(teamId ?? null)),
    // Still empty: let the gate wait up to its ceiling, not the base window.
    active: vaults.length === 0,
  });

  // `quiet` re-reads without the "Loading…" swap, for the polls below.
  const load = useCallback(
    async (quiet = false) => {
      if (!admin || !teamId) return;
      if (!quiet) setLoading(true);
      try {
        setVaults(await listVaults(admin, teamId));
        setListedForTeam(teamId);
        setError(null);
      } catch (e) {
        setError(describeError(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [admin, teamId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing else re-reads the list, so while the gate is up keep asking — and
  // that covers a read that failed because the team had not synced yet. A
  // vault can also be listed before its context arrives (it cannot be opened
  // until then), so keep asking while one is missing, for as long as the gate
  // would wait at most: an invite-only vault's context may never show here.
  const awaitingContext = vaults.some((v) => !v.contextId);
  useEffect(() => {
    if (!isSyncing && !awaitingContext) return;
    const since = Date.now();
    const timer = setInterval(() => {
      if (!isSyncing && Date.now() - since >= JOIN_SYNC_MAX_MS) {
        clearInterval(timer);
        return;
      }
      void load(true);
    }, JOIN_SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [isSyncing, awaitingContext, load]);

  useEffect(() => {
    if (!admin || !appId || !teamId) return;
    let cancelled = false;
    listTeams(admin, appId)
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
  }, [admin, appId, teamId]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!admin || !appId || !teamId || !name) return;
    setError(null);
    try {
      await createVault(
        admin,
        { applicationId: appId, namespaceId: teamId, name, restricted },
        setBusy,
      );
      setNewName('');
      setRestricted(false);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, [admin, appId, teamId, newName, restricted, load]);

  const open = useCallback(
    async (vault: VaultRow) => {
      if (!admin || !vault.contextId) return;
      setError(null);
      try {
        await enterVaultContext(
          admin,
          {
            vaultId: vault.vaultId,
            contextId: vault.contextId,
            // Invite-only: this node is either already a direct member (it was
            // invited to the vault) or will be refused — inheritance cannot
            // admit anyone to it.
            direct: vault.restricted,
            // The team this vault belongs to. Inheritance eligibility is
            // decided against the PARENT, so this is the group whose state
            // the retry has to wait for — see `joinVaultWithRetry`.
            namespaceId: teamId,
          },
          setBusy,
        );
        navigate(`/vault/${vault.contextId}`);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [admin, navigate, teamId],
  );

  const inviteToTeam = useCallback(async () => {
    if (!admin || !teamId) return;
    setError(null);
    try {
      const code = await mintTeamInvite(
        admin,
        { namespaceId: teamId, teamName: heading, validForSecs: validFor },
        setBusy,
      );
      setInvite({
        code,
        scope: `Whole team · ${heading}`,
        hint: `Anyone who opens this link within ${validLabel} can join the team and open every vault that is not invite-only. Their devices get each vault's key once a member who holds it opens the vault.`,
      });
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, [admin, teamId, heading, validFor, validLabel]);

  const inviteToVault = useCallback(
    async (vault: VaultRow) => {
      if (!admin || !teamId) return;
      setError(null);
      try {
        const code = await mintVaultInvite(
          admin,
          {
            namespaceId: teamId,
            vaultId: vault.vaultId,
            vaultName: vault.name,
            teamName: heading,
            contextId: vault.contextId,
            validForSecs: validFor,
            restricted: vault.restricted,
          },
          setBusy,
        );
        setInvite({
          code,
          scope: `Opens ${vault.name}`,
          // Said plainly: an OPEN vault's access is inherited from the team,
          // so a link to it grants every open vault there. Only an invite-only
          // vault can be granted on its own.
          hint: vault.restricted
            ? `“${vault.name}” is invite-only: this link admits them to it and to ${heading}, but to no other invite-only vault. Valid for ${validLabel}.`
            : `This link lands them in “${vault.name}”, but the access it grants is the whole of ${heading} — every open vault in the team, including ones added later. Valid for ${validLabel}.`,
        });
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [admin, teamId, heading, validFor, validLabel],
  );

  return (
    <AppShell back={{ label: 'Vaults', to: '/teams' }} crumb={heading}>
      <main className={styles.mainWide}>
        <div className={styles.titleRow}>
          <div className={styles.titleRowHead}>
            <span
              className={`${styles.avatar} ${styles.avatarLarge}`}
              style={{ '--hue': hueOf(heading) } as CSSProperties}
              aria-hidden="true"
            >
              {monogramOf(heading)}
            </span>
            <div>
              <p className={styles.eyebrow}>Team</p>
              <h1 className={styles.title} data-testid="team-heading">
                {heading}
              </h1>
              <p className={styles.subtitle}>
                Open vaults are shared with everyone in this team; invite-only
                vaults with the people invited to them.
              </p>
            </div>
          </div>
          {mayInvite && (
            <div className={styles.titleRowActions}>
              <select
                className={styles.input}
                value={validFor}
                onChange={(e) => setValidFor(Number(e.target.value))}
                aria-label="Invitations expire after"
                title="Invitations expire after"
                data-testid="invite-validity"
              >
                {INVITE_VALIDITY.map((v) => (
                  <option key={v.secs} value={v.secs}>
                    Expires in {v.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={styles.btn}
                onClick={() => void inviteToTeam()}
                disabled={!!busy}
                data-testid="invite-team"
              >
                <PlusIcon size={15} /> Invite
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
        {hostingNotice && (
          <p className={styles.status} data-testid="hosting-notice">
            This team exists, but nobody can join it yet: {hostingNotice}.
          </p>
        )}

        {tab === 'vaults' ? (
          <>
            {!mayCreateVault && !capsLoading && (
              <p className={styles.status} data-testid="member-notice">
                You are a Member of this team, so you can open every vault below
                but not create new ones. An Admin can change that under People.
              </p>
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
                  ? ' Create one below — everyone already in the team gets it.'
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
                      <span className={styles.cardTop}>
                        <span
                          className={styles.avatar}
                          style={
                            { '--hue': hueOf(vault.name) } as CSSProperties
                          }
                          aria-hidden="true"
                        >
                          {monogramOf(vault.name)}
                        </span>
                        <span className={styles.cardName}>{vault.name}</span>
                      </span>
                      <span className={styles.cardSub}>
                        {vault.restricted && (
                          <span className={styles.chip}>Invite-only</span>
                        )}
                        <span className={styles.chip}>
                          {vault.memberCount} member
                          {vault.memberCount === 1 ? '' : 's'}
                        </span>
                        {vault.contextId ? (
                          vault.joined ? (
                            <span
                              className={`${styles.chip} ${styles.chipGood}`}
                            >
                              You are in
                            </span>
                          ) : (
                            <span className={styles.chip}>Not joined</span>
                          )
                        ) : (
                          <span className={`${styles.chip} ${styles.chipWait}`}>
                            Syncing
                          </span>
                        )}
                      </span>
                    </button>
                    {/* An open vault's invitation is a TEAM invitation with
                        routing hints, which an account can mint. An
                        invite-only vault's needs a subgroup invitation too,
                        which only a node can — so that path is hidden on an
                        account rather than failing at the mint. */}
                    {mayInvite &&
                      vault.contextId &&
                      !(isDelegated && vault.restricted) && (
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
                          <PlusIcon size={15} />
                        </button>
                      )}
                  </div>
                ))}
              </div>
            )}

            {mayCreateVault && (
              <div className={`${styles.panel} ${styles.panelSpaced}`}>
                <div className={styles.panelHead}>
                  <span className={styles.panelIcon} aria-hidden="true">
                    <PlusIcon size={18} />
                  </span>
                  <span>
                    <span className={styles.panelTitle}>Add a vault</span>
                    <br />
                    <span className={styles.panelSub}>
                      Everyone in the team gets an open vault; an invite-only
                      one only the people you invite to it.
                    </span>
                  </span>
                </div>
                <div className={styles.createRow}>
                  <input
                    className={styles.input}
                    placeholder="New vault name — “Bank logins”, “Production keys”…"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void create()}
                    aria-label="New vault name"
                    data-testid="vault-name"
                  />
                  {/* Not offered to an account: an invite-only vault is only
                      reachable by a vault invitation, and minting one is a
                      node's operation (`createGroupInvitation` has no account
                      form yet). An account would create a vault nobody else
                      could ever be let into. */}
                  {!isDelegated && (
                    <label className={styles.check}>
                      <input
                        type="checkbox"
                        checked={restricted}
                        onChange={(e) => setRestricted(e.target.checked)}
                        data-testid="vault-restricted"
                      />
                      Invite-only
                    </label>
                  )}
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={() => void create()}
                    disabled={!admin || !appId || !newName.trim() || !!busy}
                    data-testid="vault-create"
                  >
                    Create
                  </button>
                </div>
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
    </AppShell>
  );
}
