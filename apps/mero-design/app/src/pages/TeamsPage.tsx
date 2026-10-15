import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import { createNamespace, deleteNamespace, listNamespaces } from "../api/rpc";
import { useApplicationId } from "../hooks/useApplicationId";
import Logo from "../components/Logo";
import SettingsModal from "../components/SettingsModal";
import { useToast } from "../contexts/ToastContext";
import { extractErrorMessage } from "../utils/errorMessage";
import { setStoredTeamName, teamLabel } from "../utils/teamName";
import type { Team } from "../types";
import ThemeToggle from "../components/ThemeToggle";
import { EmptyTeamsArt } from "../components/Artwork";
import { initialsOf, tileGradient } from "../utils/artwork";
import { IconPlus } from "../components/HomeIcons";
import { truncateMiddle } from "../utils/format";
import styles from "./Home.module.css";

export default function TeamsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { logout, isDelegated } = useMero();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // MeroDesign's own application id — see hooks/useApplicationId.
  const ensureAppId = useApplicationId();

  useEffect(() => {
    let cancelled = false;
    async function loadTeams() {
      const appId = await ensureAppId();
      listNamespaces(appId)
        .then((items) => {
          if (cancelled) return;
          setTeams(items.map((n) => ({ groupId: n.namespaceId, name: n.name ?? "" })));
        })
        .catch(() => { if (!cancelled) setTeams([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    loadTeams();
    const id = setInterval(loadTeams, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [ensureAppId]);

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
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the Mero Design application first.");
        return;
      }
      // On a node this is the node's own namespace; on an account the admin
      // founds it through the relay, as the account, and asks the cloud to host
      // it. The body is the same either way.
      const data = await createNamespace(appId, name);
      const id = data.namespaceId;
      // Cache the name so it survives even if the server later returns no alias,
      // and so it can be embedded in invitations for joiners.
      if (id) setStoredTeamName(id, name);
      setTeams((prev) => [...prev, { groupId: id, name }]);
      setNewName("");
      // Say it now, not at invite time: an unhosted team's invitations cannot
      // be claimed, and "link this account in the wallet" is the fix.
      if (data.haError) {
        showToast(`Team created, but it is not hosted yet: ${data.haError}`);
      }
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not create team."));
    } finally {
      setCreating(false);
    }
  }

  async function deleteTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await deleteNamespace(teamId);
    } catch {
      // best-effort
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
  }

  function handleLogout() {
    logout();
    navigate("/");
  }

  const createField = (
    <div className={styles.field}>
      <input
        className={styles.input}
        placeholder="New team name…"
        aria-label="New team name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && createTeam()}
      />
      <button className={styles.btn} onClick={createTeam} disabled={creating}>
        Create
      </button>
    </div>
  );

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.brand}><Logo size={30} /> <span className={styles.brandText}>Mero Design</span></span>
        <div className={styles.headerRight}>
          <ThemeToggle className={styles.iconBtn} />
          <button className={styles.logoutBtn} onClick={handleLogout}>Logout</button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <div>
            <p className={styles.eyebrow}>Workspace</p>
            <h1 className={styles.title}>Your Teams</h1>
            <p className={styles.subtitle}>
              A team is the people you design with. Its boards live on its members&rsquo; nodes and sync
              between them directly, with no server keeping a copy.
            </p>
          </div>
        </div>

        {loading ? (
          <div className={styles.grid} aria-busy="true" aria-label="Loading teams">
            {[0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
          </div>
        ) : teams.length === 0 ? (
          <section className={`${styles.panel} ${styles.empty}`}>
            <EmptyTeamsArt />
            <h2 className={styles.emptyTitle}>Start your first team</h2>
            <p className={styles.emptyText}>
              No teams yet. Name one and create it, then invite people from its page —
              or open an invitation link someone sent you.
            </p>
            <div className={styles.emptyField}>{createField}</div>
          </section>
        ) : (
          <>
            <div className={styles.actions}>
              <section className={`${styles.panel} ${styles.actionCard}`}>
                <div className={styles.actionHead}>
                  <span className={styles.actionIcon} aria-hidden="true"><IconPlus /></span>
                  <span>
                    <span className={styles.actionTitle}>New team</span>
                    <span className={styles.actionHint}>Name it, then invite people from inside.</span>
                  </span>
                </div>
                {createField}
              </section>
            </div>

            <div className={styles.sectionHead}>
              <h2 className={styles.sectionTitle}>Teams</h2>
              <span className={styles.count}>{teams.length}</span>
            </div>
            <div className={styles.grid}>
              {teams.map((t) => {
                const label = teamLabel(t.groupId, t.name);
                const open = menuOpenId === t.groupId;
                return (
                  <div
                    key={t.groupId}
                    className={`${styles.cardWrap} ${open ? styles.cardWrapOpen : ""}`}
                    ref={open ? menuRef : null}
                  >
                    <button
                      className={styles.card}
                      onClick={() => navigate(`/teams/${t.groupId}/projects`)}
                    >
                      <span className={styles.teamBanner} style={{ background: tileGradient(t.groupId) }}>
                        <span className={styles.avatar} aria-hidden="true">{initialsOf(label)}</span>
                      </span>
                      <span className={styles.cardBody}>
                        <span className={styles.cardName}>{label}</span>
                        <span className={styles.cardMeta}>
                          Team <span className={styles.metaDot} aria-hidden="true" />
                          <span className={styles.metaId}>{truncateMiddle(t.groupId, 6, 4)}</span>
                        </span>
                      </span>
                    </button>
                    <button
                      className={styles.menuBtn}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(open ? null : t.groupId); }}
                      title="More options"
                    >⋯</button>
                    {open && (
                      <div className={styles.dropdown}>
                        <button className={styles.dropdownItem} onClick={() => { setMenuOpenId(null); setSettingsTeam(t); }}>
                          Settings
                        </button>
                        {/* Deleting a namespace is a node's own operation; an
                            account's relay has no form of it. */}
                        {!isDelegated && (
                          <button className={`${styles.dropdownItem} ${styles.dropdownDanger}`} onClick={() => deleteTeam(t.groupId)}>
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
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
