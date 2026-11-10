import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { ConnectExistingOrg } from "@calimero-apps/passkey";
import { messageOf } from "../api/pixart";
import { useSignedIn } from "../api/sessionContext";
import { lastUsedName } from "@calimero-apps/names";
import {
  CONNECTED_PROJECT,
  createProject,
  createTeam as createOrgTeam,
  leaveTeam as leaveOrgTeam,
  leaveTeamOrg,
  listTeams,
  PRODUCT_NAME,
  ownsTeam,
  setMyTeamName,
  type Team,
} from "../api/teams";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import { legacyUsername } from "../utils/projectName";
import { clearLastVisit, forgetTeam, pickRemembered, readLastVisit, shouldResume } from "../utils/lastVisit";
import styles from "./TeamsPage.module.css";

/**
 * The teams this account is in: Calimero organizations (v1: namespaces of
 * this app). Orgs are the platform's teams, so one made in another Calimero
 * 1.0 app is listed too and can hold projects.
 */
export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { client, accountId, source, passkey, after, targetKey, signOut } = useSignedIn();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // The cluster has answered the list (empty or not). A failed read has not, and
  // must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Your name in the new team: asked here, once, and used by every project in it.
  const [myName, setMyName] = useState(() => lastUsedName() || legacyUsername());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const loadTeams = useCallback(async () => {
    try {
      setTeams(await listTeams(client, source));
      setListed(true);
    } catch {
      /* the last answer stays; the next poll tries again */
    } finally {
      setLoading(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => clearInterval(id);
  }, [loadTeams]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and the cluster still lists it. Anything
  // else settles here: a remembered team no longer listed is forgotten, and
  // the entry is replaced so Back or a reload to it is a plain visit to the list.
  const resume = shouldResume(location);
  const remembered = readLastVisit(targetKey).team;
  const resumeTo = resume && listed ? pickRemembered(teams.map((t) => t.groupId), remembered) : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(targetKey, remembered);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [resume, loading, listed, resumeTo, remembered, targetKey, navigate, location.pathname, location.search]);

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

  // "Connect to an existing organization": this app goes into an org the
  // account has for another app only on this explicit choice.
  const loadOtherOrgs = useCallback(async () => {
    try {
      return await otherOrgs(client, source);
    } finally {
      after();
    }
  }, [client, source, after]);
  const connectOrg = useCallback(
    async (org: OtherOrg) => {
      try {
        await createProject(client, source, org.orgId, CONNECTED_PROJECT, passkey);
      } finally {
        after();
      }
      setStoredTeamName(org.orgId, org.name);
      navigate(`/teams/${org.orgId}/projects`);
    },
    [client, source, passkey, after, navigate],
  );

  async function createTeam() {
    const name = newName.trim();
    const me = myName.trim();
    if (!name || !me) return;
    setCreating(true);
    try {
      const { groupId, warning } = await createOrgTeam(client, name, passkey, source);
      setStoredTeamName(groupId, name);
      // Best effort: without it the team's first project asks, once.
      await setMyTeamName(client, groupId, accountId, me).catch(() => {});
      setTeams((prev) => [...prev, { groupId, name, role: "owner" }]);
      setNewName("");
      if (warning) showToast(warning);
    } catch (err) {
      showToast(`Could not create team: ${messageOf(err)}`);
    } finally {
      setCreating(false);
      after();
    }
  }

  /** The team's owner deletes it (a passkey step-up), with its projects. */
  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await client.deleteOrg(teamId, passkey());
    } catch (err) {
      showToast(`Could not delete team: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(targetKey, teamId);
  }

  /**
   * Anyone else leaves it (a passkey step-up). In an org that keeps its apps
   * apart that is Mero Pixart only; when it was the last app there, the
   * organization itself is offered too.
   */
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      const left = await leaveOrgTeam(client, teamId, source, passkey, accountId);
      if (
        left.left === "app" &&
        left.lastApp &&
        window.confirm(`${PRODUCT_NAME} was your last app in this organization. Leave the organization too?`)
      ) {
        await leaveTeamOrg(client, teamId, passkey, accountId);
      }
    } catch (err) {
      showToast(`Could not leave team: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(targetKey, teamId);
  }

  async function handleLogout() {
    clearLastVisit(targetKey);
    await signOut();
    navigate("/");
  }

  if (resumeTo) return <Navigate to={`/teams/${resumeTo}/projects`} replace state={{ resume: true }} />;

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}><Logo size={24} /> Mero PixArt</span>
        <div className={styles.headerRight}>
          <button className="mp-btn mp-btn--ghost" onClick={() => void handleLogout()}>Logout</button>
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
          <input
            className={`mp-input ${styles.createInput}`}
            placeholder="Your name in this team…"
            aria-label="Your name in this team"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            maxLength={32}
            data-testid="new-team-my-name"
          />
          <button
            className="mp-btn mp-btn--primary"
            onClick={createTeam}
            disabled={creating || !newName.trim() || !myName.trim()}
            data-testid="create-team-btn"
          >
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>
        <ConnectExistingOrg appName="Mero PixArt" load={loadOtherOrgs} onConnect={connectOrg} />

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
                    {/* The owner deletes, anyone else leaves. */}
                    {ownsTeam(t.role) && (
                      <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                        Delete
                      </button>
                    )}
                    {!ownsTeam(t.role) && (
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
          namespaceId={settingsTeam.groupId}
          name={teamLabel(settingsTeam.groupId, settingsTeam.name)}
          onClose={() => setSettingsTeam(null)}
        />
      )}
    </div>
  );
}
