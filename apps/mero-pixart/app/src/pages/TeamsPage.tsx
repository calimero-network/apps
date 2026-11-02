import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { createTeam as createOrgTeam, isTeamAdmin, listTeams, type TeamRow } from "../api/teams";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { useSignedIn } from "../sessionContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import { clearLastVisit, forgetTeam, pickRemembered, readLastVisit, shouldResume } from "../utils/lastVisit";
import styles from "./TeamsPage.module.css";

/**
 * Your teams: the organizations this account is in (v1: the app's namespaces
 * on your node). An owner or admin deletes a team; anyone else leaves it, both
 * approved with a passkey.
 */
export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { client, accountId, scope, passkey, after, signOut } = useSignedIn();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  // The cluster has answered the list (empty or not). A failed read has not,
  // and must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsTeam, setSettingsTeam] = useState<TeamRow | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      try {
        const rows = await listTeams(client);
        if (cancelled) return;
        for (const t of rows) setStoredTeamName(t.groupId, t.name);
        setTeams(rows);
        setListed(true);
      } catch {
        if (!cancelled) setTeams([]);
      } finally {
        after();
        if (!cancelled) setLoading(false);
      }
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [client, after]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and the cluster still lists it. A
  // remembered team no longer listed is forgotten.
  const resume = shouldResume(location);
  const remembered = readLastVisit(scope).team;
  const resumeTo = resume && listed ? pickRemembered(teams.map((t) => t.groupId), remembered) : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(scope, remembered);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [resume, loading, listed, resumeTo, remembered, scope, navigate, location.pathname, location.search]);

  // Close menu on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function createTeam() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const { groupId, warning } = await createOrgTeam(client, name, passkey);
      setStoredTeamName(groupId, name);
      setTeams((prev) => [...prev, { groupId, name, role: "owner" }]);
      setNewName("");
      if (warning) showToast(warning);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
      after();
    }
  }

  // Owner only: deleting the org deletes every project in it. A passkey step-up.
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await client.deleteOrg(teamId, passkey());
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not delete team."));
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(scope, teamId);
  }

  // Anyone but the owner may leave. A passkey step-up.
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await client.removeMember(teamId, accountId, passkey());
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not leave team."));
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(scope, teamId);
  }

  async function handleLogout() {
    clearLastVisit(scope);
    await signOut();
    navigate("/");
  }

  if (resumeTo) return <Navigate to={`/teams/${resumeTo}/projects`} replace state={{ resume: true }} />;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}><Logo size={24} /> Mero PixArt</span>
        <div className={styles.headerRight}>
          <button className="mp-btn mp-btn--ghost" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        <p className={styles.subtitle}>Teams are shared workspaces. Each holds image projects you edit together.</p>

        <div className={styles.createRow}>
          <input
            className={`mp-input ${styles.createInput}`}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-input"
          />
          <button
            className="mp-btn mp-btn--primary"
            onClick={createTeam}
            disabled={creating || !newName.trim()}
            data-testid="create-team-btn"
          >
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty} data-testid="empty-teams">No teams yet. Create one above, or open an invitation link someone sent you.</p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <div key={t.groupId} className={styles.cardWrap} ref={menuOpenId === t.groupId ? menuRef : null}>
                <button
                  className={styles.card}
                  onClick={() => navigate(`/teams/${t.groupId}/projects`)}
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}><Logo size={20} color="var(--accent)" /></span>
                  <span className={styles.cardName}>{teamLabel(t.groupId, t.name)}</span>
                  <span className={styles.cardSub}>{isTeamAdmin(t.role) ? `Team workspace · ${t.role}` : "Team workspace"}</span>
                </button>
                <button
                  className={styles.menuBtn}
                  onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === t.groupId ? null : t.groupId); }}
                  title="More options"
                >⋯</button>
                {menuOpenId === t.groupId && (
                  <div className={styles.dropdown}>
                    <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); setSettingsTeam(t); }}>
                      Settings
                    </button>
                    {t.role === "owner" && (
                      <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                        Delete
                      </button>
                    )}
                    {t.role !== "owner" && (
                      <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => leaveTeam(t.groupId)}>
                        Leave
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {settingsTeam && (
        <SettingsModal
          type="team"
          id={settingsTeam.groupId}
          name={teamLabel(settingsTeam.groupId, settingsTeam.name)}
          onClose={() => setSettingsTeam(null)}
        />
      )}
    </div>
  );
}
