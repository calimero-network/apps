import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero, useNodeIdentity } from '@calimero-network/mero-react';
import { Lock } from '@calimero-network/mero-icons';

import AppShell from '../../components/AppShell';
import InviteModal from '../../components/InviteModal';
import { ChevronIcon, PlusIcon, UsersIcon } from '../../components/icons';
import { useApplicationId } from '../../hooks/useApplicationId';
import { useRedeemInvitation } from '../../hooks/useRedeemInvitation';
import { NOT_AN_INVITATION, parseInvitation } from '../../lib/redeemFlow';
import {
  createPersonalVault,
  createTeam,
  listTeams,
  listVaults,
  mintTeamInvite,
} from '../../lib/vaults';
import type { TeamRow } from '../../lib/vaults';
import { hueOf, monogramOf } from '../../lib/itemView';
import styles from '../../styles/shell.module.css';
import { describeError } from '../../lib/errors';

/**
 * Your teams. The app's front screen once you are signed in.
 *
 * ── The noun ────────────────────────────────────────────────────────────────
 *
 * A TEAM is a namespace: the people. A VAULT is a subgroup and its context: the
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
  // `admin`, never `mero.admin`: the session-aware client. On an account the
  // raw client's admin is the relay's node route and answers 403 to every
  // call on this screen — the list, the creates, the invitation, the join —
  // which rendered as "Mero Pass is not installed on this node". See
  // `lib/vaults` `AdminLike`.
  const { admin } = useMero();
  // ⚠️ `accountId`, never `publicKey` and never a context executor identity —
  // all three are 64 hex since rc.27, so a swap type-checks, returns 200, and
  // grants a principal that exists nowhere. See `useTeamCapabilities`.
  const { identity } = useNodeIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const { appId, resolving, notInstalled } = useApplicationId();

  const [teams, setTeams] = useState<TeamRow[]>([]);
  // The personal vault's context, resolved at load so the card can go straight
  // into the secrets rather than via a team screen that would list exactly one
  // vault and offer to invite people to it.
  const [personalVaultId, setPersonalVaultId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ code: string; scope: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Joining by paste ──────────────────────────────────────────────────────
  //
  // The link path (`components/InvitationPrompt`) only fires when the
  // invitation is OPENED. An invitation forwarded in a chat message, read off
  // a phone, or copied with the dialog's "Copy code" button never opens
  // anything — and until this field there was nowhere to put it. The empty
  // state said "open an invitation link someone sent you", which was the only
  // honest instruction and not a usable one.
  const [joinCode, setJoinCode] = useState('');
  const redeemer = useRedeemInvitation();

  const load = useCallback(async () => {
    if (!admin || !appId) {
      setLoading(resolving);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTeams(admin, appId);
      setTeams(rows);
      const mine = rows.find((t) => t.personal);
      if (mine) {
        // One extra request, only when a personal vault exists. A failure here
        // degrades the card to "open the namespace" rather than emptying the
        // screen — the vault still exists either way.
        const vaults = await listVaults(admin, mine.namespaceId).catch(
          () => [],
        );
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
  }, [admin, appId, resolving]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(async () => {
    const raw = joinCode.trim();
    if (!raw) return;
    const payload = parseInvitation(raw);
    if (!payload) {
      // Not an invitation at all, which is a different failure from one that
      // was refused — and the only one the person can do something about.
      redeemer.setError(NOT_AN_INVITATION);
      return;
    }
    const { destination } = await redeemer.redeem(payload);
    if (!destination) return;
    setJoinCode('');
    // ⚠️ A join that cannot be placed — the team is joined but its vaults
    // have not replicated here yet — resolves to `/teams`, which is THIS
    // page. React Router does not remount for a navigation to where you
    // already are, so `load` (whose deps are the node and the app id, neither
    // of which changed) never re-runs: the new team is missing from the list,
    // the field has cleared, and a successful join reads as a no-op until a
    // full reload.
    if (destination === location.pathname) await load();
  }, [joinCode, redeemer, load, location.pathname]);

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

  const create = useCallback(async () => {
    const name = newName.trim();
    if (!admin || !appId || !name) return;
    setError(null);
    try {
      const { namespaceId, haError } = await createTeam(
        admin,
        { applicationId: appId, name, accountId: identity?.accountId ?? null },
        setBusy,
      );
      setNewName('');
      await load();
      // The team exists either way. What `haError` says is that nobody can
      // JOIN it yet (an account the cloud cannot place, typically one not yet
      // linked to its cloud user) — so the team screen says that now, next to
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
  }, [admin, appId, newName, load, navigate, identity?.accountId]);

  const createPersonal = useCallback(async () => {
    if (!admin || !appId) return;
    setError(null);
    try {
      const { contextId } = await createPersonalVault(
        admin,
        { applicationId: appId },
        setBusy,
      );
      await load();
      navigate(`/vault/${contextId}`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }, [admin, appId, load, navigate]);

  const inviteTo = useCallback(
    async (team: TeamRow) => {
      if (!admin) return;
      setMenuOpenId(null);
      setError(null);
      try {
        const code = await mintTeamInvite(
          admin,
          { namespaceId: team.namespaceId, teamName: team.name },
          setBusy,
        );
        setInvite({ code, scope: `Whole team · ${team.name}` });
      } catch (e) {
        setError(describeError(e));
      } finally {
        setBusy(null);
      }
    },
    [admin],
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
              onClick={() => void createPersonal()}
              disabled={!admin || !appId || !!busy}
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

        {notInstalled ? (
          <p className={styles.empty} data-testid="not-installed">
            Mero Pass is not installed on this node. Install it from the app
            registry, then reload.
          </p>
        ) : loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : sharedTeams.length === 0 ? (
          // ⚠️ Only when the load SUCCEEDED and came back empty. A failed list
          // is not evidence of no teams, and saying "No teams yet" under a 503
          // tells someone their data is gone when the node merely did not
          // answer.
          error ? null : (
            <p className={styles.empty} data-testid="teams-empty">
              No teams yet. Start one or paste an invitation below.
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
              <input
                className={styles.input}
                placeholder="New team name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
                aria-label="New team name"
                data-testid="team-name"
              />
              <button
                type="button"
                className={styles.btn}
                onClick={() => void create()}
                disabled={!admin || !appId || !newName.trim() || !!busy}
                data-testid="team-create"
              >
                Create
              </button>
            </div>
          </div>

          <div className={styles.panel} data-testid="join-section">
            <div className={styles.panelHead}>
              <span className={styles.panelIcon} aria-hidden="true">
                <UsersIcon size={18} />
              </span>
              <span>
                <span className={styles.panelTitle}>
                  Got an invitation? Join a team.
                </span>
                <br />
                <span className={styles.panelSub}>
                  Joining a team gives you every vault in it.
                </span>
              </span>
            </div>
            <div className={styles.createRow}>
              <input
                className={styles.input}
                placeholder="Paste the link or code you were sent…"
                value={joinCode}
                onChange={(e) => {
                  setJoinCode(e.target.value);
                  // Clear a previous complaint as soon as they start fixing
                  // it; a stale error under a field they have just edited
                  // reads as the new value being rejected too.
                  if (redeemer.error) redeemer.setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void join()}
                aria-label="Invitation link or code"
                data-testid="join-code"
              />
              <button
                type="button"
                className={styles.btn}
                onClick={() => void join()}
                disabled={!admin || !joinCode.trim() || redeemer.busy}
                data-testid="join-submit"
              >
                {redeemer.busy ? 'Joining…' : 'Join'}
              </button>
            </div>
            <p className={styles.sectionHint}>
              Opening the link works too — you only need this if it arrived as
              text.
            </p>
            {redeemer.status && (
              <p className={styles.status} data-testid="join-status">
                {redeemer.status}
              </p>
            )}
            {redeemer.error && (
              <p className={styles.error} data-testid="join-error">
                {redeemer.error}
              </p>
            )}
          </div>
        </div>
      </main>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint="Anyone who opens this link can join the team and read every vault in it."
        onClose={() => setInvite(null)}
      />
    </AppShell>
  );
}
