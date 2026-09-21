import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMero, useNodeIdentity } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import InviteModal from '../../components/InviteModal';
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
import styles from '../../styles/shell.module.css';

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
 * MeroDesign's Teams screen, taken rather than approximated: #fafafa page, one
 * 800px column, a 22px title, a create row, and a grid of white cards on
 * #e0e0e0 with a ⋯ menu that appears on hover. What was here was a mero-ui
 * `Card` stack on a dark background with a search box above it and a "Reload"
 * button — three different button styles and a navbar that rendered the
 * connection flow to somebody already connected.
 */
export default function TeamsPage() {
  const { mero } = useMero();
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
    if (!mero || !appId) {
      setLoading(resolving);
      return;
    }
    setLoading(true);
    try {
      const rows = await listTeams(mero.admin, appId);
      setTeams(rows);
      const mine = rows.find((t) => t.personal);
      if (mine) {
        // One extra request, only when a personal vault exists. A failure here
        // degrades the card to "open the namespace" rather than emptying the
        // screen — the vault still exists either way.
        const vaults = await listVaults(mero.admin, mine.namespaceId).catch(
          () => [],
        );
        setPersonalVaultId(vaults[0]?.contextId ?? null);
      } else {
        setPersonalVaultId(null);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [mero, appId, resolving]);

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
    const destination = await redeemer.redeem(payload);
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
    if (!mero || !appId || !name) return;
    setError(null);
    try {
      const { namespaceId } = await createTeam(
        mero.admin,
        { applicationId: appId, name, accountId: identity?.accountId ?? null },
        setBusy,
      );
      setNewName('');
      await load();
      navigate(`/teams/${namespaceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, appId, newName, load, navigate, identity?.accountId]);

  const createPersonal = useCallback(async () => {
    if (!mero || !appId) return;
    setError(null);
    try {
      const { contextId } = await createPersonalVault(
        mero.admin,
        { applicationId: appId },
        setBusy,
      );
      await load();
      navigate(`/vault/${contextId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [mero, appId, load, navigate]);

  const inviteTo = useCallback(
    async (team: TeamRow) => {
      if (!mero) return;
      setMenuOpenId(null);
      setError(null);
      try {
        const code = await mintTeamInvite(
          mero.admin,
          { namespaceId: team.namespaceId, teamName: team.name },
          setBusy,
        );
        setInvite({ code, scope: `Whole team · ${team.name}` });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [mero],
  );

  // Two different things share one listing on the wire. Split them here so no
  // screen below has to remember which kind of row it is looking at.
  const personalTeam = teams.find((t) => t.personal) ?? null;
  const sharedTeams = teams.filter((t) => !t.personal);

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <h1 className={styles.title}>Your vaults</h1>
        <p className={styles.subtitle}>
          Keep credentials to yourself in your private vault, or share them with
          people you invite to a team.
        </p>

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
          <div className={styles.grid}>
            <button
              type="button"
              className={styles.card}
              onClick={() =>
                navigate(
                  personalVaultId
                    ? `/vault/${personalVaultId}`
                    : `/teams/${personalTeam.namespaceId}`,
                )
              }
              data-testid="personal-card"
            >
              <span className={styles.cardName}>{personalTeam.name}</span>
              <span className={styles.cardSub}>Only you · never shared</span>
            </button>
          </div>
        ) : (
          <div className={styles.createRow}>
            <p className={styles.empty} style={{ margin: 0, flex: 1 }}>
              A vault only you can open, synced across your own devices.
            </p>
            <button
              type="button"
              className={styles.btn}
              onClick={() => void createPersonal()}
              disabled={!mero || !appId || !!busy}
              data-testid="personal-create"
            >
              Create private vault
            </button>
          </div>
        )}

        <h2 className={styles.sectionTitle}>Teams</h2>
        <p className={styles.subtitle}>
          A team is the people. Every vault inside it is readable by everyone
          you invite.
        </p>

        <div className={styles.createRow}>
          <input
            className={styles.input}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void create()}
            data-testid="team-name"
          />
          <button
            type="button"
            className={styles.btn}
            onClick={() => void create()}
            disabled={!mero || !appId || !newName.trim() || !!busy}
            data-testid="team-create"
          >
            Create
          </button>
        </div>

        {error && (
          <p className={styles.error} data-testid="error">
            {error}
          </p>
        )}
        {busy && <p className={styles.status}>{busy}</p>}

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
              No teams yet. Create one above, or paste an invitation below.
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
                  <span className={styles.cardName}>{team.name}</span>
                  <span className={styles.cardSub}>
                    {team.vaultCount} vault{team.vaultCount === 1 ? '' : 's'} ·{' '}
                    {team.memberCount} member{team.memberCount === 1 ? '' : 's'}
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
                  data-testid="team-menu"
                >
                  ⋯
                </button>
                {menuOpenId === team.namespaceId && (
                  <div className={styles.dropdown} data-testid="team-dropdown">
                    <button
                      type="button"
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
                      className={styles.dropdownItem}
                      onClick={() => void inviteTo(team)}
                    >
                      Invite someone
                    </button>
                    <button
                      type="button"
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

        {/* ── Join ────────────────────────────────────────────────────────
            Below the list rather than beside the create row: creating a team
            and joining somebody else's are different intents, and a person
            doing one is not half-doing the other. Same placement as Mero
            Sign's workspaces screen.
        */}
        <div className={styles.section} data-testid="join-section">
          <p className={styles.sectionLabel}>Got an invitation? Join a team.</p>
          <div className={styles.createRow}>
            <input
              className={styles.input}
              placeholder="Paste the link or code you were sent…"
              value={joinCode}
              onChange={(e) => {
                setJoinCode(e.target.value);
                // Clear a previous complaint as soon as they start fixing it;
                // a stale error under a field they have just edited reads as
                // the new value being rejected too.
                if (redeemer.error) redeemer.setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void join()}
              data-testid="join-code"
            />
            <button
              type="button"
              className={styles.btn}
              onClick={() => void join()}
              disabled={!mero || !joinCode.trim() || redeemer.busy}
              data-testid="join-submit"
            >
              {redeemer.busy ? 'Joining…' : 'Join'}
            </button>
          </div>
          <p className={styles.sectionHint}>
            Opening the link works too — you only need this if it arrived as
            text. Joining a team gives you every vault in it.
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
      </main>

      <InviteModal
        open={!!invite}
        code={invite?.code ?? ''}
        scope={invite?.scope ?? ''}
        hint="Anyone who opens this link can join the team and read every vault in it."
        onClose={() => setInvite(null)}
      />
    </div>
  );
}
