import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { otherOrgs, type OtherOrg } from '@calimero-apps/connect';
import { CreateWorkspaceDialog } from '@calimero-network/mero-react';
import { lastUsedName } from '@calimero-apps/names';
import {
  ConnectExistingOrg,
  reviewRelease,
  useResolvedSource,
} from '@calimero-apps/passkey';
import { Lock } from '@calimero-network/mero-icons';

import AppShell from '../../components/AppShell';
import PassInviteDialog, { type PassInvite } from '../../components/PassInviteDialog';
import { ChevronIcon, PlusIcon } from '../../components/icons';
import { useCalimero } from '../../calimero';
import {
  CONNECTED_VAULT_NAME,
  createVault,
  finishPersonalVault,
  finishTeam,
  listTeams,
  listVaults,
  inviteTeams,
} from '../../lib/vaults';
import type { TeamRow } from '../../lib/vaults';
import { hueOf, monogramOf } from '../../lib/itemView';
import styles from '../../styles/shell.module.css';
import { describeError } from '../../lib/errors';
import { PACKAGE } from '../../lib/meroPass';
import { pickTeam, readLastVisit } from '../../lib/lastVisit';

const TEAM_LABELS = {
  title: 'New team',
  subtitle: 'Name your team. You become its Admin and can invite people.',
  nameLabel: 'Team name',
  namePlaceholder: 'e.g. Family',
  selfLabel: 'Your name in this team',
  selfPlaceholder: 'e.g. Ana',
};

const PRIVATE_LABELS = {
  title: 'Private vault',
  subtitle: 'A vault only you can open, synced across your own devices.',
  nameLabel: 'Vault name',
  namePlaceholder: 'e.g. Private',
  selfLabel: 'Your name',
  selfPlaceholder: 'e.g. Ana',
};

/**
 * Your teams. The app's front screen once you are signed in.
 *
 * ── The noun ────────────────────────────────────────────────────────────────
 *
 * A TEAM is an organization: the people. A VAULT is an app instance in it: the
 * secrets. You invite someone to a team; the vaults in it are then shared with
 * them. This replaces "space", which said nothing about what the thing is for —
 * and every password manager that has this concept calls it a team, a family or
 * an organisation, never a space.
 *
 * ── The look ────────────────────────────────────────────────────────────────
 *
 * The fleet's glass: the private vault as one wide card on top, the teams as
 * a grid of frosted cards (a monogram tile, the counts as chips, a ⋯ menu on
 * hover), and "start a team" beside "join a team" as two panels underneath.
 */
export default function TeamsPage() {
  const { client, accountId, source, passkey, after, where } = useCalimero();
  const { source: release, pending: releasePending } = useResolvedSource(
    client,
    accountId,
    source,
  );
  const conn = useMemo(
    () => (client ? { client, source, passkey, after } : null),
    [client, source, passkey, after],
  );
  const nodeUrl = where;
  const navigate = useNavigate();
  const location = useLocation();
  // Instances come from the package (or the dev bundle): nothing to resolve.

  const [teams, setTeams] = useState<TeamRow[]>([]);
  // The personal vault's context, resolved at load so the card can go straight
  // into the secrets rather than via a team screen that would list exactly one
  // vault and offer to invite people to it.
  const [personalVaultId, setPersonalVaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState<'team' | 'private' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ org: string; invite: PassInvite } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!conn) return;
    setLoading(true);
    try {
      const rows = await listTeams(conn);
      setTeams(rows);
      const mine = rows.find((t) => t.personal);
      if (mine) {
        // One extra request, only when a personal vault exists. A failure here
        // degrades the card to "open the namespace" rather than emptying the
        // screen — the vault still exists either way.
        const vaults = await listVaults(conn, mine.namespaceId).catch(() => []);
        setPersonalVaultId(vaults[0]?.contextId ?? null);
      } else {
        setPersonalVaultId(null);
      }
      setError(null);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, [conn]);

  // Keyed on the navigation too. Accepting an invitation navigates to where
  // the person now belongs, and a team whose vaults have not replicated yet
  // lands on `/teams` — this page. React Router does not remount for that, and
  // neither the node nor the app id changed, so without the key the joined
  // team would be missing from the list until a full reload.
  useEffect(() => {
    void load();
  }, [load, location.key]);

  // Arriving from the landing redirect (`state.resume`: a sign-in, a cold
  // open, a reload of the desktop window), go on to the team open last if this
  // node still lists it; the team screen carries the mark on to its vault.
  // Otherwise the mark is DROPPED, by replacing this entry without it: left in
  // place, Back from the team you then open would land on a resuming `/teams`
  // and send you straight back into it. Reached any other way, this is the list.
  const resume = (location.state as { resume?: boolean } | null)?.resume;
  useEffect(() => {
    if (!resume || loading) return;
    if (!conn) return; // not listed yet
    const target = error
      ? null
      : pickTeam(
          teams.map((t) => t.namespaceId),
          readLastVisit(nodeUrl).team,
        );
    navigate(target ? `/teams/${target}` : location.pathname, {
      replace: true,
      state: target ? { resume: true } : null,
    });
  }, [
    resume,
    loading,
    conn,
    error,
    teams,
    nodeUrl,
    navigate,
    location.pathname,
  ]);

  // A dropdown that does not close on an outside click is a dropdown that
  // covers the next thing you try to press.
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const teamCreated = useCallback(
    async ({ orgId, selfName }: { orgId: string; selfName: string }) => {
      if (!conn) return;
      setCreating(null);
      setError(null);
      try {
        const { namespaceId, warning: haError } = await finishTeam(
          conn,
          orgId,
          accountId ?? '',
          selfName,
          setBusy,
        );
        await load();
        // The team exists either way. What `haError` says is that nobody can
        // JOIN it yet (an account the cloud cannot place, typically one not yet
        // linked to its cloud user) - so the team screen says that now, next to
        // the invite controls, rather than the first invitation failing later.
        navigate(
          `/teams/${namespaceId}`,
          haError ? { state: { hostingNotice: haError } } : undefined,
        );
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [conn, accountId, load, navigate],
  );

  // "Connect to an existing organization": a vault goes into an org the
  // account has for another app only on this explicit choice.
  const loadOtherOrgs = useCallback(async () => {
    if (!conn) return [];
    try {
      return await otherOrgs(conn.client, conn.source);
    } finally {
      conn.after?.();
    }
  }, [conn]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      if (!conn) return;
      await createVault(conn, { namespaceId: org.orgId, name: CONNECTED_VAULT_NAME, restricted: false }, setBusy).finally(() =>
        setBusy(null),
      );
      await load();
      navigate(`/teams/${org.orgId}`);
    },
    [conn, load, navigate],
  );

  const personalCreated = useCallback(
    async ({ orgId, name }: { orgId: string; name: string }) => {
      if (!conn) return;
      setCreating(null);
      setError(null);
      try {
        const { contextId } = await finishPersonalVault(conn, orgId, name, setBusy);
        await load();
        navigate(`/vault/${contextId}`);
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [conn, load, navigate],
  );

  const inviteTo = useCallback(
    async (team: TeamRow) => {
      if (!conn) return;
      setMenuOpenId(null);
      setError(null);
      try {
        setInvite({
          org: team.namespaceId,
          invite: {
            ...(await inviteTeams(conn, team.namespaceId)),
            linkOrg: team.namespaceId,
            title: `Invite to ${team.name}`,
            subtitle: 'Whoever opens this link can join the team and read every vault in it. Choose what they can do.',
          },
        });
      } catch (e) {
        setError(describeError(e));
      } finally {
        conn.after?.();
      }
    },
    [conn],
  );

  // Two different things share one listing on the wire. Split them here so no
  // screen below has to remember which kind of row it is looking at.
  const personalTeam = teams.find((t) => t.personal) ?? null;
  const sharedTeams = teams.filter((t) => !t.personal);

  return (
    <AppShell crumb="Your vaults">
      <main className={styles.main}>
        <p className={styles.eyebrow}>End-to-end encrypted</p>
        <h1 className={styles.title}>Your vaults</h1>
        <p className={styles.subtitle}>
          Keep credentials to yourself in your private vault, or share them with
          people you invite to a team.
        </p>

        {error && (
          <p className={styles.error} data-testid="error">
            {error}
          </p>
        )}
        {busy && <p className={styles.status}>{busy}</p>}

        {/* ── Private ──────────────────────────────────────────────────────
            Above the teams, because it is the one vault that is always yours
            and the one most people open most often. It is created on request
            rather than on first load: a write that happens by itself the
            moment a screen renders races a second device doing the same, and
            this app has already been bitten by lazy-create minting duplicates.
        */}
        <h2 className={styles.sectionTitle}>Private</h2>
        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : personalTeam ? (
          <button
            type="button"
            className={styles.hero}
            onClick={() =>
              navigate(
                personalVaultId
                  ? `/vault/${personalVaultId}`
                  : `/teams/${personalTeam.namespaceId}`,
              )
            }
            data-testid="personal-card"
          >
            <span className={styles.heroIcon} aria-hidden="true">
              <Lock size={26} />
            </span>
            <span className={styles.heroText}>
              <span className={styles.heroName}>{personalTeam.name}</span>
              <span className={styles.heroSub}>
                Only you · never shared · synced across your own devices
              </span>
            </span>
            <span className={styles.heroGo} aria-hidden="true">
              Open <ChevronIcon size={14} />
            </span>
          </button>
        ) : (
          <div className={`${styles.hero} ${styles.heroOffer}`}>
            <span className={styles.heroIcon} aria-hidden="true">
              <Lock size={26} />
            </span>
            <span className={styles.heroText}>
              <span className={styles.heroName}>A vault just for you</span>
              <span className={styles.heroSub}>
                A vault only you can open, synced across your own devices.
              </span>
            </span>
            <button
              type="button"
              className={styles.btn}
              onClick={() => setCreating('private')}
              disabled={!conn || !!busy}
              data-testid="personal-create"
            >
              Create private vault
            </button>
          </div>
        )}

        <h2 className={styles.sectionTitle}>
          Teams
          {!loading && sharedTeams.length > 0 && (
            <span className={styles.sectionCount}>{sharedTeams.length}</span>
          )}
        </h2>
        <p className={styles.subtitle}>
          A team is the people. Every vault inside it is readable by everyone
          you invite.
        </p>

        {loading && teams.length === 0 ? (
          <p className={styles.empty}>Loading…</p>
        ) : sharedTeams.length === 0 ? (
          // ⚠️ Only when the load SUCCEEDED and came back empty. A failed list
          // is not evidence of no teams, and saying "No teams yet" under a 503
          // tells someone their data is gone when the node merely did not
          // answer.
          error ? null : (
            <p className={styles.empty} data-testid="teams-empty">
              No teams yet. Start one, or open an invitation link someone sent
              you.
            </p>
          )
        ) : (
          <div className={styles.grid} data-testid="team-grid">
            {sharedTeams.map((team) => (
              <div
                key={team.namespaceId}
                className={styles.cardWrap}
                ref={menuOpenId === team.namespaceId ? menuRef : null}
              >
                <button
                  type="button"
                  className={styles.card}
                  onClick={() => navigate(`/teams/${team.namespaceId}`)}
                  data-testid="team-card"
                >
                  <span className={styles.cardTop}>
                    <span
                      className={styles.avatar}
                      style={{ '--hue': hueOf(team.name) } as CSSProperties}
                      aria-hidden="true"
                    >
                      {monogramOf(team.name)}
                    </span>
                    <span className={styles.cardName}>{team.name}</span>
                  </span>
                  <span className={styles.cardSub}>
                    <span className={styles.chip}>
                      {team.vaultCount} vault{team.vaultCount === 1 ? '' : 's'}
                    </span>
                    <span className={styles.chip}>
                      {team.memberCount} member
                      {team.memberCount === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.menuBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(
                      menuOpenId === team.namespaceId ? null : team.namespaceId,
                    );
                  }}
                  title="More options"
                  aria-label={`More options for ${team.name}`}
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === team.namespaceId}
                  data-testid="team-menu"
                >
                  ⋯
                </button>
                {menuOpenId === team.namespaceId && (
                  <div
                    className={styles.dropdown}
                    role="menu"
                    data-testid="team-dropdown"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        navigate(`/teams/${team.namespaceId}`);
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.dropdownItem}
                      onClick={() => void inviteTo(team)}
                    >
                      Invite someone
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.dropdownItem}
                      onClick={() => {
                        setMenuOpenId(null);
                        navigate(`/teams/${team.namespaceId}?tab=people`);
                      }}
                    >
                      People
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── Start one, or join one ──────────────────────────────────────
            Side by side: creating a team and joining somebody else's are
            different intents, and a person doing one is not half-doing the
            other. Same pairing as Mero Sign's workspaces screen.
        */}
        <div className={styles.split}>
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <span className={styles.panelIcon} aria-hidden="true">
                <PlusIcon size={18} />
              </span>
              <span>
                <span className={styles.panelTitle}>Start a team</span>
                <br />
                <span className={styles.panelSub}>
                  You become its Admin and can invite people.
                </span>
              </span>
            </div>
            <div className={styles.createRow}>
              <button
                type="button"
                className={styles.btn}
                onClick={() => setCreating('team')}
                disabled={!conn || !!busy}
                data-testid="team-create"
              >
                New team
              </button>
            </div>
            <ConnectExistingOrg appName="Mero Pass" load={loadOtherOrgs} onConnect={connectOrg} />
          </div>
        </div>
      </main>

      {(invite?.org ?? teams[0]?.namespaceId) && (
        <PassInviteDialog
          org={(invite?.org ?? teams[0]?.namespaceId)!}
          invite={invite?.invite ?? null}
          onClose={() => setInvite(null)}
        />
      )}

      {client && (
        <CreateWorkspaceDialog
          client={client}
          passkey={passkey()}
          release={
            releasePending
              ? null
              : (reviewRelease(release) ?? { package: PACKAGE })
          }
          defaultSelfName={lastUsedName()}
          open={creating !== null}
          onClose={() => setCreating(null)}
          onCreated={creating === 'private' ? personalCreated : teamCreated}
          labels={creating === 'private' ? PRIVATE_LABELS : TEAM_LABELS}
        />
      )}
    </AppShell>
  );
}
