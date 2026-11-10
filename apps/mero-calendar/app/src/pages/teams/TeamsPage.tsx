import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { otherOrgs, type OtherOrg } from "@calimero-apps/connect";
import { ConnectExistingOrg } from "@calimero-apps/passkey";
import { lastUsedName } from "@calimero-apps/names";
import { messageOf } from "../../api/calendar";
import { useSignedIn } from "../../api/sessionContext";
import {
  CONNECTED_CALENDAR_NAME,
  createCalendar,
  createTeam as createOrgTeam,
  inviteLink,
  inviteToken,
  listTeams,
  ownsTeam,
  setMyTeamName,
  type Team,
} from "../../api/teams";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import LogoutButton from "../../components/common/logout-button/LogoutButton";
import { useToast } from "../../contexts/ToastContext";
import { setStoredTeamName, teamLabel } from "../../utils/teamName";
import {
  forgetTeam,
  pickRemembered,
  readLastVisit,
  shouldResume,
} from "../../utils/lastVisit";
import styles from "./teams.module.scss";

/**
 * The teams this account is in: Calimero organizations (v1: namespaces of
 * this app). Orgs are the platform's teams, so one made in another Calimero
 * 1.0 app is listed too and can hold calendars.
 */
export default function TeamsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { client, accountId, source, passkey, after, targetKey } = useSignedIn();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  // The cluster has answered the list (empty or not). A failed read has not, and
  // must not forget a team it simply could not see.
  const [listed, setListed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  // Your name in the new team, asked here once: every calendar in it uses it.
  const [myName, setMyName] = useState(() => lastUsedName());
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [inviteFor, setInviteFor] = useState<{ id: string; link: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);

  const loadTeams = useCallback(async () => {
    try {
      setTeams(await listTeams(client, source));
      setListed(true);
    } catch {
      /* the last answer stays; the next poll or focus tries again */
    } finally {
      setLoading(false);
      after();
    }
  }, [client, source, after]);

  useEffect(() => {
    void loadTeams();
    const id = setInterval(loadTeams, 30_000);
    window.addEventListener("focus", loadTeams);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", loadTeams);
    };
  }, [loadTeams]);

  // Resume the team open last (utils/lastVisit) when this is the default
  // landing, not a visit you chose, and the cluster still lists it. Anything
  // else settles here: a remembered team no longer listed is forgotten, and
  // the entry is replaced so Back or a reload to it is a plain visit to the list.
  const resume = shouldResume(location);
  const remembered = readLastVisit(targetKey).team;
  const resumeTo =
    resume && listed
      ? pickRemembered(
          teams.map((t) => t.groupId),
          remembered,
        )
      : null;
  useEffect(() => {
    if (!resume || loading || resumeTo) return;
    if (listed && remembered) forgetTeam(targetKey, remembered);
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [
    resume,
    loading,
    listed,
    resumeTo,
    remembered,
    targetKey,
    navigate,
    location.pathname,
    location.search,
  ]);

  // Close dropdown on outside click
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
        await createCalendar(client, source, org.orgId, CONNECTED_CALENDAR_NAME);
      } finally {
        after();
      }
      setStoredTeamName(org.orgId, org.name);
      navigate(`/teams/${org.orgId}`);
    },
    [client, source, after, navigate],
  );

  async function createTeam() {
    const name = newName.trim();
    const me = myName.trim();
    if (!name || !me) return;
    setCreating(true);
    try {
      const { groupId, warning } = await createOrgTeam(client, name, passkey, source);
      setStoredTeamName(groupId, name);
      // Best effort: the team exists either way, and a calendar in it asks
      // once when the name is missing.
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

  /** The team's owner deletes it (a passkey step-up), with its calendars. */
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

  /** Anyone else leaves it: removes their own membership (a passkey step-up). */
  async function leaveTeam(teamId: string) {
    setMenuOpenId(null);
    try {
      await client.removeMember(teamId, accountId, passkey());
    } catch (err) {
      showToast(`Could not leave team: ${messageOf(err)}`);
      return;
    } finally {
      after();
    }
    setTeams((prev) => prev.filter((t) => t.groupId !== teamId));
    forgetTeam(targetKey, teamId);
  }

  /** Open a team by showing its calendars. */
  function openTeam(teamId: string) {
    setMenuOpenId(null);
    navigate(`/teams/${teamId}`);
  }

  async function generateInvite(teamId: string) {
    setMenuOpenId(null);
    try {
      // An org invite, approved with this account's passkey. The link is all
      // there is to share: opening it (and signing in) joins the team.
      const token = await inviteToken(client, teamId, passkey());
      // The link names the team, so someone already in it is not joined again.
      setInviteFor({ id: teamId, link: inviteLink(token, { href: new URL(appRoot(), window.location.origin).href }, teamId) });
    } catch (err) {
      showToast(`Failed to generate invitation: ${messageOf(err)}`);
    } finally {
      after();
    }
  }

  async function copyInvite() {
    if (!inviteFor) return;
    await navigator.clipboard.writeText(inviteFor.link);
    showToast("Invitation link copied to clipboard.", "success");
  }

  if (resumeTo) {
    return (
      <Navigate to={`/teams/${resumeTo}`} replace state={{ resume: true }} />
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Mero Calendar
        </span>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <LogoutButton />
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Your Teams</h1>

        <p className={styles.subtitle}>Teams are shared calendars.</p>

        <div className={styles.createRow}>
          <input
            className={`mc-input ${styles.createInput}`}
            placeholder="New team name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-input"
          />
          <input
            className={`mc-input ${styles.createInput}`}
            placeholder="Your name in this team"
            aria-label="Your name in this team"
            value={myName}
            onChange={(e) => setMyName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createTeam()}
            data-testid="new-team-my-name"
          />
          <button
            className="mc-btn mc-btn--primary"
            onClick={createTeam}
            disabled={creating || !newName.trim() || !myName.trim()}
            data-testid="create-team-btn"
          >
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>
        <ConnectExistingOrg appName="Mero Calendar" load={loadOtherOrgs} onConnect={connectOrg} />

        {loading ? (
          <p className={styles.empty}>Loading…</p>
        ) : teams.length === 0 ? (
          <p className={styles.empty} data-testid="empty-teams">
            No teams yet. Create one above, or open an invitation link someone
            sent you.
          </p>
        ) : (
          <div className={styles.grid}>
            {teams.map((t) => (
              <div
                key={t.groupId}
                className={styles.cardWrap}
                ref={menuOpenId === t.groupId ? menuRef : null}
              >
                <button
                  className={styles.card}
                  onClick={() => openTeam(t.groupId)}
                  data-testid={`team-card-${t.groupId}`}
                >
                  <span className={styles.cardIcon}>
                    <CalendarLogo size={20} color="var(--accent)" />
                  </span>
                  <span className={styles.cardName}>
                    {teamLabel(t.groupId, t.name)}
                  </span>
                  <span className={styles.cardSub}>Shared calendars</span>
                </button>
                <button
                  className={styles.menuBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === t.groupId ? null : t.groupId);
                  }}
                  title="More options"
                  data-testid={`team-menu-${t.groupId}`}
                >
                  ⋯
                </button>
                {menuOpenId === t.groupId && (
                  <div className={styles.dropdown}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => openTeam(t.groupId)}
                    >
                      Open calendar
                    </button>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => generateInvite(t.groupId)}
                    >
                      Invite
                    </button>
                    {/* The owner deletes, anyone else leaves. */}
                    {ownsTeam(t.role) && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => deleteTeam(t.groupId)}
                        data-testid={`delete-team-${t.groupId}`}
                      >
                        Delete
                      </button>
                    )}
                    {!ownsTeam(t.role) && (
                      <button
                        className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                        onClick={() => leaveTeam(t.groupId)}
                        data-testid={`leave-team-${t.groupId}`}
                      >
                        Leave
                      </button>
                    )}
                  </div>
                )}
                {inviteFor?.id === t.groupId && (
                  <div className={styles.inviteBox}>
                    <code className={styles.inviteCode} title={inviteFor.link}>
                      {inviteFor.link.slice(0, 40)}…{inviteFor.link.slice(-8)}
                    </code>
                    <span
                      className={styles.inviteNote}
                      data-testid="invite-single-use"
                      title="One person can join with this link. Generate another for each person you invite."
                    >
                      Single use
                    </span>
                    <button
                      className="mc-btn"
                      onClick={copyInvite}
                      data-testid="copy-invite"
                    >
                      Copy
                    </button>
                    <button
                      className="mc-btn mc-btn--ghost"
                      onClick={() => setInviteFor(null)}
                    >
                      ✕
                    </button>
                  </div>
                )}

              </div>
            ))}
          </div>
        )}

      </main>
    </div>
  );
}

/** Where this frontend's routes start: the page's path up to `/teams`. */
function appRoot(): string {
  const { pathname } = window.location;
  const at = pathname.indexOf("/teams");
  return at >= 0 ? pathname.slice(0, at) || "/" : "/";
}
