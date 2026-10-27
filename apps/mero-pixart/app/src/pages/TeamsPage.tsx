import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useMero } from "@calimero-apps/cloud";
import { useApi } from "../api/useApi";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import { clearLastVisit, forgetTeam, pickRemembered, readLastVisit, shouldResume } from "../utils/lastVisit";
import { selfIsGroupAdmin } from "../api/selfRole";
import type { Team } from "../types";
import styles from "./TeamsPage.module.css";

/** What `createNamespace` answers on an account: founding also asks the cloud to host (HA). */
type CreatedNamespace = { namespaceId?: string; haEnabled?: boolean; haError?: string };

export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { logout, nodeUrl } = useMero();
  // The session-aware API (see api/useApi): the node's own admin on a node
  // login, the account admin on a delegated session. Shared by list/create/join
  // so namespaces are always scoped to (and created under) the right app.
  const api = useApi();
  const { admin, isDelegated } = api;
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // The node has answered the list (empty or not). A failed read has not, and
  // must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);
  // Whether this session is an Admin of each team, by team id. Absent while
  // unknown: the menu then offers neither Delete nor Leave rather than guessing.
  const [adminOf, setAdminOf] = useState<Record<string, boolean>>({});
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await api.ensureAppId();
      // On an account the id is the registry's, and lands after sign-in.
      // Unscoped until then, the list is every namespace the account has,
      // other apps' included, shown here as teams. Stay loading: `api`
      // changes when the id lands, and this runs again.
      if (!appId && api.isDelegated) return;
      api.listNamespaces(appId)
        .then((items) => {
          if (cancelled) return;
          setTeams(items.map((n) => ({
            groupId: n.namespaceId ?? "",
            name: n.name ?? "",
          })));
          setListed(true);
        })
        .catch(() => { if (!cancelled) setTeams([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [api]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and this node still lists it. Anything
  // else settles here: a remembered team the node no longer lists is
  // forgotten, and the entry is replaced so Back or a reload to it is a
  // plain visit to the list.
  const resume = shouldResume(location);
  const remembered = readLastVisit(nodeUrl).team;
  const resumeTo = resume && listed ? pickRemembered(teams.map((t) => t.groupId), remembered) : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(nodeUrl, remembered);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [resume, loading, listed, resumeTo, remembered, nodeUrl, navigate, location.pathname, location.search]);

  // An Admin deletes a team; anyone else leaves it. Asked of each team's own
  // member listing, by the account this session runs as. Keyed on the ids, so
  // the 30s list poll does not re-ask while the teams stay the same.
  const teamIds = teams.map((t) => t.groupId).join(",");
  useEffect(() => {
    const ids = teamIds ? teamIds.split(",") : [];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      let self = "";
      try { self = (await api.getNodeIdentity()).accountId ?? ""; } catch { /* unknown: no admin controls */ }
      const entries = await Promise.all(
        ids.map(async (id) => [id, await selfIsGroupAdmin(admin, id, self)] as const),
      );
      if (!cancelled) setAdminOf(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [teamIds, api, admin]);

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
      const applicationId = await api.ensureAppId();
      if (!applicationId) {
        showToast("Select or install the Mero PixArt application first.");
        return;
      }
      // Body is EXACTLY `applicationId` + `name`: `CreateNamespaceApiRequest`
      // is `deny_unknown_fields`, so an extra key is a 400 for the whole
      // create. On an account this founds through the relay with the
      // provider's package, and also asks the cloud to host the namespace so
      // invitees can find it — `haError` says why when it could not.
      const data = (await admin.createNamespace({ applicationId, name })) as CreatedNamespace;
      const id = data.namespaceId ?? "";
      // Cache the name so it survives even if the server later returns no name,
      // and so it can be embedded in invitations for joiners.
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      if (data.haError) {
        // Said now, where it can be acted on, rather than at invite time.
        showToast(`Team created, but it is not hosted yet: ${data.haError}`);
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  // Admin only, and a node's own operation: deleting a namespace has no account
  // form, so the control is hidden on a delegated session rather than offered
  // and refused. The card goes only once the node has accepted the delete.
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await admin.deleteNamespace(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not delete team."));
      return;
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(nodeUrl, teamId);
  }

  // Not an admin: leave the team. Works on a node and on an account alike.
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await admin.leaveNamespace(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not leave team."));
      return;
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(nodeUrl, teamId);
  }

  function handleLogout() {
    // Before `logout()`, which drops the node URL the entry is keyed by.
    clearLastVisit(nodeUrl);
    logout();
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
                  <span className={styles.cardSub}>Team workspace</span>
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
                    {adminOf[t.groupId] === true && !isDelegated && (
                      <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                        Delete
                      </button>
                    )}
                    {adminOf[t.groupId] === false && (
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
