import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import AppHeader from '../../components/AppHeader';
import InviteModal from '../../components/InviteModal';
import { useApplicationId } from '../../hooks/useApplicationId';
import { createTeam, listTeams, mintTeamInvite } from '../../lib/vaults';
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
      setTeams(await listTeams(mero.admin, appId));
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

  return (
    <div className={styles.root}>
      <AppHeader />

      <main className={styles.main}>
        <h1 className={styles.title}>Your teams</h1>
        <p className={styles.subtitle}>
          A team is the people. The vaults inside it are shared with everyone
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
        ) : teams.length === 0 ? (
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
            {teams.map((team) => (
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
