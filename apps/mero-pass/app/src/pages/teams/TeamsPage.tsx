import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import InviteModal from '../../components/InviteModal';
import { useApplicationId } from '../../hooks/useApplicationId';
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
  const navigate = useNavigate();
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
        { applicationId: appId, name },
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
  }, [mero, appId, newName, load, navigate]);

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
              No teams yet. Create one above, or open an invitation link someone
              sent you.
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
