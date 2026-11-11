import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { CalimeroError } from "@calimero-network/mero-js";
import { askAnOwnerCopy, canCreateIn } from "@calimero-apps/connect";
import { messageOf } from "../../api/calendar";
import { useSignedIn } from "../../api/sessionContext";
import {
  createCalendar as createCalendarIn,
  isAdmin,
  listCalendars,
  readOrg,
  type CalendarEntry,
} from "../../api/teams";
import TeamMembersPanel from "./TeamMembersPanel";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import LogoutButton from "../../components/common/logout-button/LogoutButton";
import { useToast } from "../../contexts/ToastContext";
import {
  calendarLabel,
  clearStoredCalendarName,
  getStoredTeamName,
  setStoredCalendarName,
  setStoredTeamName,
  teamLabel,
} from "../../utils/teamName";
import {
  forgetCalendar,
  pickRemembered,
  readLastVisit,
  rememberTeam,
  resumeRequested,
} from "../../utils/lastVisit";
import { useClickOutside } from "../../hooks/useClickOutside";
import styles from "./teams.module.scss";

/**
 * Choosing which calendar inside a team to open, and removing the ones that
 * have served their purpose.
 *
 * A team (an org) holds any number of calendars: instances of this app made
 * in the org, each with its own name, which every member reads from the
 * cluster. There is nothing to join or wait for: v1's join-and-sync step is
 * gone, an instance is on the cluster as soon as it exists.
 */
export default function TeamCalendarsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { teamId = "" } = useParams();
  const { showToast } = useToast();
  const { client, accountId, source, passkey, after, targetKey } = useSignedIn();

  const [calendars, setCalendars] = useState<CalendarEntry[]>([]);
  const [teamName, setTeamName] = useState(() => teamLabel(teamId, getStoredTeamName(teamId)));
  const [myRole, setMyRole] = useState<string | undefined>(undefined);
  const [membersOpen, setMembersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  /** The team whose calendar list has come back, empty or not. */
  const [listedFor, setListedFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  /**
   * Whether this account may add a calendar here (core's `CREATE_APP`): a
   * plain member may not unless an owner or admin let them. `null` while it
   * is unknown, when the create row is shown and the node decides.
   */
  const [mayCreate, setMayCreate] = useState<boolean | null>(null);
  /** The node says this account is not in the team (a deep link opened by an outsider). */
  const [outsider, setOutsider] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, () => setMenuOpenId(null));

  const load = useCallback(async () => {
    try {
      const [list, read, may] = await Promise.all([
        listCalendars(client, source, teamId),
        readOrg(client, teamId).then(
          (org) => ({ org, refused: false }),
          // The node refuses a team's details to an account not in it.
          (e: unknown) => ({ org: null, refused: notInTeam(e) }),
        ),
        canCreateIn(client, teamId),
      ]);
      const { org } = read;
      setCalendars(list);
      setListedFor(teamId);
      setMayCreate(may);
      setOutsider(read.refused || (org !== null && !org.roles.has(accountId)));
      if (org) {
        if (org.name) {
          setTeamName(org.name);
          setStoredTeamName(teamId, org.name);
        }
        setMyRole(org.roles.get(accountId));
      }
    } catch {
      /* the last answer stays; the next poll or focus tries again */
    } finally {
      setLoading(false);
      after();
    }
  }, [client, source, teamId, accountId, after]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 30_000);
    window.addEventListener("focus", load);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  useEffect(() => {
    if (teamId) rememberTeam(targetKey, teamId);
  }, [teamId, targetKey]);

  const nameOf = useCallback(
    (cid: string) => calendarLabel(cid, calendars.find((c) => c.contextId === cid)?.name),
    [calendars],
  );

  function openCalendar(contextId: string, opts?: { replace?: boolean }) {
    const to = `/teams/${teamId}/calendar/${contextId}`;
    if (opts?.replace) navigate(to, { replace: true });
    else navigate(to);
  }

  // Resume the calendar open last in this team, when the teams list sent us
  // here to resume and the cluster still lists it.
  const resume = resumeRequested(location);
  const resumed = useRef(false);
  useEffect(() => {
    if (!resume || !teamId || listedFor !== teamId || resumed.current) return;
    resumed.current = true;
    const remembered = readLastVisit(targetKey).calendars?.[teamId];
    const target = pickRemembered(
      calendars.map((c) => c.contextId),
      remembered,
    );
    if (target) {
      openCalendar(target, { replace: true });
      return;
    }
    if (remembered) forgetCalendar(targetKey, teamId, remembered);
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume, teamId, listedFor, calendars, targetKey, navigate, location.pathname, location.search]);

  async function createCalendar() {
    const name = newName.trim() || teamName;
    setCreating(true);
    try {
      const contextId = await createCalendarIn(client, source, teamId, name, passkey);
      setStoredCalendarName(contextId, name);
      setNewName("");
      navigate(`/teams/${teamId}/calendar/${contextId}`);
    } catch (err) {
      showToast(`Could not create calendar: ${messageOf(err)}`);
    } finally {
      setCreating(false);
      after();
    }
  }

  /** Its creator or a team admin deletes a calendar, for everyone. */
  const canDelete = (cid: string) =>
    isAdmin(myRole) || calendars.find((c) => c.contextId === cid)?.owner === accountId;

  async function removeCalendar(contextId: string) {
    setConfirmId(null);
    setMenuOpenId(null);
    setBusyId(contextId);
    try {
      await client.apps.delete({ app: contextId });
      clearStoredCalendarName(contextId);
      setCalendars((prev) => prev.filter((c) => c.contextId !== contextId));
      forgetCalendar(targetKey, teamId, contextId);
      showToast("Calendar deleted.", "success");
      await load();
    } catch (err) {
      showToast(`Could not delete the calendar: ${messageOf(err)}`);
    } finally {
      setBusyId(null);
      after();
    }
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
        <button
          className={styles.backLink}
          onClick={() => navigate("/teams")}
          data-testid="back-to-teams"
        >
          ← All teams
        </button>

        <div className={styles.titleRow}>
          <h1 className={styles.title}>{teamName}</h1>
          <button
            className="mc-btn"
            onClick={() => setMembersOpen(true)}
            data-testid="open-members"
          >
            Members
          </button>
        </div>
        {outsider ? (
          <p className={styles.empty} role="status" data-testid="team-not-member">
            You're not in this team, so its calendars are not yours to see. Ask someone in it for an invite
            link.
          </p>
        ) : (
          <>
            <p className={styles.subtitle}>
              {mayCreate === false
                ? "Pick a calendar to open."
                : "Pick a calendar to open, or start another one in this team."}
            </p>

            {mayCreate === false ? (
              <p className={styles.subtitle} data-testid="create-calendar-ask">
                {askAnOwnerCopy("a calendar")}
              </p>
            ) : (
              <div className={styles.createRow}>
                <input
                  className={`mc-input ${styles.createInput}`}
                  placeholder="New calendar name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createCalendar()}
                  data-testid="new-calendar-input"
                />
                <button
                  className="mc-btn mc-btn--primary"
                  onClick={createCalendar}
                  disabled={creating}
                  data-testid="create-calendar-btn"
                >
                  {creating ? "Creating…" : "New calendar"}
                </button>
              </div>
            )}

            {loading ? (
              <p className={styles.empty}>Loading calendars…</p>
            ) : calendars.length === 0 ? (
              <p className={styles.empty} data-testid="empty-calendars">
                {mayCreate === false
                  ? "No calendars in this team yet."
                  : "No calendars in this team yet. Create the first one above."}
              </p>
            ) : (
              <div className={styles.grid}>
                {calendars.map(({ contextId: cid }) => (
                  <div className={styles.cardWrap} key={cid}>
                    <button
                      className={styles.card}
                      onClick={() => openCalendar(cid)}
                      disabled={busyId === cid}
                      data-testid={`calendar-card-${cid}`}
                    >
                      <span className={styles.cardIcon}>
                        <CalendarLogo size={18} color="var(--accent)" />
                      </span>
                      <span className={styles.cardName}>{nameOf(cid)}</span>
                      <span className={styles.cardSub}>{cid.slice(0, 12)}…</span>
                    </button>

                    {/* Only rendered when there is something to offer. */}
                    {canDelete(cid) && (
                      <button
                        className={styles.menuBtn}
                        onClick={() =>
                          setMenuOpenId((prev) => (prev === cid ? null : cid))
                        }
                        aria-label="Calendar options"
                        data-testid={`calendar-menu-${cid}`}
                      >
                        ⋯
                      </button>
                    )}

                    {menuOpenId === cid && canDelete(cid) && (
                      <div className={styles.dropdown} ref={menuRef}>
                        {canDelete(cid) && (
                          <button
                            className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                            onClick={() => setConfirmId(cid)}
                            data-testid={`delete-calendar-${cid}`}
                          >
                            Delete calendar
                          </button>
                        )}
                      </div>
                    )}

                    {confirmId === cid && (
                      <div className={styles.confirmBox} data-testid="confirm-delete">
                        <p className={styles.confirmText}>
                          Delete <strong>{nameOf(cid)}</strong> for everyone in
                          this team? Its events are removed for all members.
                        </p>
                        <div className={styles.confirmRow}>
                          <button
                            className="mc-btn mc-btn--ghost"
                            onClick={() => setConfirmId(null)}
                          >
                            Cancel
                          </button>
                          <button
                            className="mc-btn mc-btn--danger"
                            onClick={() => removeCalendar(cid)}
                            data-testid="confirm-delete-btn"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {membersOpen && (
        <TeamMembersPanel teamId={teamId} onClose={() => setMembersOpen(false)} onChanged={() => void load()} />
      )}
    </div>
  );
}

/** A refusal that says the account is not in the team: the node will not show it. */
function notInTeam(e: unknown): boolean {
  return e instanceof CalimeroError && (e.status === 403 || e.status === 404);
}
