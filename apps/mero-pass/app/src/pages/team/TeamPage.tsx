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
import { useCalimero } from '../../calimero';

import AppShell from '../../components/AppShell';
import InviteModal from '../../components/InviteModal';
import MembersPanel from '../../components/MembersPanel';
import { PlusIcon } from '../../components/icons';
import { useTeamCapabilities } from '../../hooks/useTeamCapabilities';
import { hueOf, monogramOf } from '../../lib/itemView';
import { pickVault, readLastVisit, rememberTeam } from '../../lib/lastVisit';
import {
  canCreateInviteOnlyVault,
  canCreateVault,
  canInvite,
} from '../../lib/roles';
import {
  DEFAULT_INVITE_SECS,
  INVITE_VALIDITY,
  createVault,
  displayName,
  listTeams,
  listVaults,
  mintTeamInvite,
  mintVaultInvite,
} from '../../lib/vaults';
import type { VaultRow } from '../../lib/vaults';
import styles from '../../styles/shell.module.css';
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
  const { client, source, passkey, after, where } = useCalimero();
  const conn = useMemo(
    () => (client ? { client, source, passkey, after } : null),
    [client, source, passkey, after],
  );
  const nodeUrl = where;
  const navigate = useNavigate();
  const location = useLocation();
  // Set by the teams screen when it resumed into this team. See the effect
  // after the list loads.
  const resume =
    (location.state as { resume?: boolean } | null)?.resume === true;
  // Handed over by the teams screen right after `createTeam`: what the team
  // cannot do yet (its member defaults were not confirmed with a passkey).
  const hostingNotice =
    (location.state as { hostingNotice?: string } | null)?.hostingNotice ??
    null;
  const [params, setParams] = useSearchParams();
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
  const mayCreateInviteOnly = canCreateInviteOnlyVault(capabilities);
  const heading = useMemo(
    () => (teamId ? displayName([teamName], teamId, 'Team') : 'Team'),
    [teamName, teamId],
  );

  // `quiet` re-reads without the "Loading…" swap, for the polls below.
  const load = useCallback(
    async (quiet = false) => {
      if (!conn || !teamId) return;
      if (!quiet) setLoading(true);
      try {
        setVaults(await listVaults(conn, teamId));
        setListedForTeam(teamId);
        setError(null);
      } catch (e) {
        setError(describeError(e));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [conn, teamId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const listed = !!teamId && listedForTeam === teamId;

  // Where you were last (`lib/lastVisit`), written only once the node has
  // listed this team's vaults, so a typo'd or stale URL is never resumed into.
  // Resumed here, go on to the vault open last if the team still lists it;
  // otherwise drop the mark (replacing this entry, so Back cannot land on a
  // resuming one) and this team is the place to come back to.
  useEffect(() => {
    if (!listed || !teamId) return;
    if (resume) {
      const last = readLastVisit(nodeUrl);
      const target =
        last.team === teamId
          ? pickVault(
              vaults.flatMap((v) => (v.contextId ? [v.contextId] : [])),
              last.vault,
            )
          : null;
      if (target) {
        navigate(`/vault/${target}`, { replace: true });
        return;
      }
      navigate(`${location.pathname}${location.search}`, { replace: true });
    }
    rememberTeam(nodeUrl, teamId);
  }, [
    listed,
    teamId,
    resume,
    vaults,
    nodeUrl,
    navigate,
    location.pathname,
    location.search,
  ]);

  useEffect(() => {
    if (!conn || !teamId) return;
    let cancelled = false;
    listTeams(conn)
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
  }, [conn, teamId]);

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!conn || !teamId || !name) return;
    setError(null);
    try {
      await createVault(
        conn,
        { namespaceId: teamId, name, restricted },
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
  }, [conn, teamId, newName, restricted, load]);

  // An instance is reachable as soon as the org lets you in: nothing to join.
  const open = useCallback(
    (vault: VaultRow) => {
      if (vault.contextId) navigate(`/vault/${vault.contextId}`);
    },
    [navigate],
  );

  const inviteToTeam = useCallback(async () => {
    if (!conn || !teamId) return;
    setError(null);
    try {
      const code = await mintTeamInvite(
        conn,
        { namespaceId: teamId, validForSecs: validFor },
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
  }, [conn, teamId, heading, validFor, validLabel]);

  const inviteToVault = useCallback(
    async (vault: VaultRow) => {
      if (!conn || !teamId) return;
      setError(null);
      try {
        const code = await mintVaultInvite(
          conn,
          { namespaceId: teamId, team: vault.team, validForSecs: validFor },
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
    [conn, teamId, heading, validFor, validLabel],
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
            This team exists, but {hostingNotice}.
          </p>
        )}

        {tab === 'vaults' ? (
          <>
            {!mayCreateVault && !capsLoading && (
              <p className={styles.status} data-testid="member-notice">
                You are a Member of this team, so you can open every vault below
                but not create new ones. An Admin can change that.
              </p>
            )}

            {loading ? (
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
                      onClick={() => open(vault)}
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
                      (!vault.restricted || mayCreateInviteOnly) && (
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
                  {mayCreateInviteOnly && (
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
                    disabled={!conn || !newName.trim() || !!busy}
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
