import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero, setApplicationId } from "@calimero-network/mero-react";
import {
  adminGet,
  adminPost,
  adminPut,
  deleteContext,
  joinContext,
  leaveContext,
  listContextsForApplication,
  listGroupContexts,
} from "../../api/rpc";
import { contextId as readContextId } from "../../api/appScope";
import { resolveApplicationId } from "../../api/appId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import {
  calendarLabel,
  clearStoredCalendarName,
  setStoredCalendarName,
  teamLabel,
} from "../../utils/teamName";
import { useClickOutside } from "../../hooks/useClickOutside";
import styles from "./teams.module.scss";

type SubgroupRaw = {
  groupId?: string;
  group_id?: string;
  id?: string;
};

/**
 * Choosing which calendar inside a team to open — and removing the ones that
 * have served their purpose.
 *
 * A team (namespace) can hold several calendars (contexts). The previous flow
 * opened whichever the node listed first and silently created one when there
 * were none, so a second calendar was reachable only by editing the URL and an
 * accidental one could never be removed. This page makes the set explicit.
 */
export default function TeamCalendarsPage() {
  const navigate = useNavigate();
  const { teamId = "" } = useParams();
  const { showToast } = useToast();
  const { applicationId, logout } = useMero();

  const [calendars, setCalendars] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside(menuRef, () => setMenuOpenId(null));

  // Mero Calendar's own application id — every list below is scoped to it, so a
  // sibling application's contexts can never show up as calendars here.
  const appIdRef = useRef<string>("");
  const ensureAppId = useCallback(async (): Promise<string> => {
    if (appIdRef.current) return appIdRef.current;
    let id = "";
    try {
      id = await resolveApplicationId();
    } catch {
      /* ignore */
    }
    if (!id) id = applicationId ?? "";
    if (id) {
      appIdRef.current = id;
      setApplicationId(id);
    }
    return id;
  }, [applicationId]);

  /** The subgroups of this team, plus the team itself: contexts hang off both. */
  const teamGroupIds = useCallback(async (): Promise<string[]> => {
    const ids = new Set<string>([teamId]);
    try {
      const raw = await adminGet<
        { subgroups?: SubgroupRaw[]; data?: SubgroupRaw[] } | SubgroupRaw[]
      >(`/groups/${teamId}/subgroups`);
      const subgroups: SubgroupRaw[] = Array.isArray(raw)
        ? raw
        : (raw as { subgroups?: SubgroupRaw[] }).subgroups ??
          (raw as { data?: SubgroupRaw[] }).data ??
          [];
      for (const sg of subgroups) {
        const id = sg.groupId ?? sg.group_id ?? sg.id ?? "";
        if (id) ids.add(id);
      }
    } catch {
      /* no subgroups yet — the team itself is still worth checking */
    }
    return [...ids];
  }, [teamId]);

  /**
   * The calendars in this team.
   *
   * Two independent lists are intersected on purpose, because each one settles
   * exactly one of the two questions and neither settles both:
   *   - walking the team's groups answers "is it in THIS team"
   *   - `/contexts/for-application` answers "is it a CALENDAR"
   * Taking either alone is how the two bugs this page replaces happened — a
   * node-wide list shows other applications' contexts, and a per-group list
   * shows whatever else someone created inside the same team.
   */
  const load = useCallback(async () => {
    const appId = await ensureAppId();

    let calendarIds: Set<string>;
    try {
      const appContexts = await listContextsForApplication(appId);
      calendarIds = new Set(appContexts.map(readContextId).filter(Boolean));
    } catch {
      calendarIds = new Set();
    }

    const groupIds = await teamGroupIds();
    const inTeam = new Set<string>();
    for (const gid of groupIds) {
      try {
        for (const ctx of await listGroupContexts(gid)) {
          const id = readContextId(ctx);
          if (id) inTeam.add(id);
        }
      } catch {
        /* a group we can't read contributes nothing */
      }
    }

    setCalendars([...inTeam].filter((id) => calendarIds.has(id)));
    setLoading(false);
  }, [ensureAppId, teamGroupIds]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        await load();
      } catch {
        if (!cancelled) {
          setCalendars([]);
          setLoading(false);
        }
      }
    }
    run();
    const timer = setInterval(run, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load]);

  async function createCalendar() {
    const name = newName.trim() || teamLabel(teamId, "");
    setCreating(true);
    try {
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the Mero Calendar application first.");
        return;
      }

      const sgData = await adminPost<{
        groupId?: string;
        group_id?: string;
        id?: string;
      }>(`/namespaces/${teamId}/groups`, {
        groupAlias: name,
        groupName: name,
      });
      const subgroupId = sgData.groupId ?? sgData.group_id ?? sgData.id ?? "";
      if (subgroupId) {
        await adminPut(`/groups/${subgroupId}/settings/subgroup-visibility`, {
          subgroupVisibility: "open",
        }).catch(() => {});
      }

      // The calendar contract's init() takes no args → empty init params.
      const ctxData = await adminPost<{ contextId?: string; id?: string }>(
        "/contexts",
        {
          applicationId: appId,
          protocol: "near",
          groupId: subgroupId || teamId,
          alias: name,
          name,
          initializationParams: [],
        },
      );
      const contextId = ctxData.contextId ?? ctxData.id ?? "";
      if (!contextId) throw new Error("The node created no calendar.");

      setStoredCalendarName(contextId, name);
      setNewName("");
      await joinContext(contextId).catch(() => {});
      navigate(`/teams/${teamId}/calendar/${contextId}`);
    } catch (err) {
      showToast(
        humanizeError(extractErrorMessage(err, "Could not create calendar.")),
      );
    } finally {
      setCreating(false);
    }
  }

  async function openCalendar(contextId: string) {
    setBusyId(contextId);
    try {
      await joinContext(contextId).catch(() => {});
      navigate(`/teams/${teamId}/calendar/${contextId}`);
    } finally {
      setBusyId(null);
    }
  }

  /**
   * Removing a calendar, in the two senses the node distinguishes.
   *
   * `delete` drops this node's copy and its local state; `leave` stops syncing
   * but keeps our copy out of the group. Neither reaches the peers — they keep
   * theirs — so the confirmation says so rather than implying a team-wide
   * deletion the API cannot perform.
   */
  async function removeCalendar(contextId: string, mode: "delete" | "leave") {
    setConfirmId(null);
    setMenuOpenId(null);
    setBusyId(contextId);
    try {
      if (mode === "delete") {
        await deleteContext(contextId);
        clearStoredCalendarName(contextId);
      } else {
        await leaveContext(contextId);
      }
      setCalendars((prev) => prev.filter((id) => id !== contextId));
      showToast(
        mode === "delete" ? "Calendar deleted." : "Left the calendar.",
        "success",
      );
      await load().catch(() => {});
    } catch (err) {
      showToast(
        humanizeError(
          extractErrorMessage(
            err,
            mode === "delete"
              ? "Could not delete the calendar."
              : "Could not leave the calendar.",
          ),
        ),
      );
    } finally {
      setBusyId(null);
    }
  }

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <CalendarLogo size={24} color="var(--accent)" /> Mero Calendar
        </span>
        <div className={styles.headerRight}>
          <ThemeToggle />
          <button className="mc-btn mc-btn--ghost" onClick={handleLogout}>
            Logout
          </button>
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

        <h1 className={styles.title}>{teamLabel(teamId, "")}</h1>
        <p className={styles.subtitle}>
          Pick a calendar to open, or start another one in this team.
        </p>

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

        {loading ? (
          <p className={styles.empty}>Loading calendars…</p>
        ) : calendars.length === 0 ? (
          <p className={styles.empty} data-testid="empty-calendars">
            No calendars in this team yet. Create the first one above.
          </p>
        ) : (
          <div className={styles.grid}>
            {calendars.map((cid) => (
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
                  <span className={styles.cardName}>{calendarLabel(cid)}</span>
                  <span className={styles.cardSub}>{cid.slice(0, 12)}…</span>
                </button>

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

                {menuOpenId === cid && (
                  <div className={styles.dropdown} ref={menuRef}>
                    <button
                      className={styles.dropdownItem}
                      onClick={() => removeCalendar(cid, "leave")}
                      data-testid={`leave-calendar-${cid}`}
                    >
                      Leave calendar
                    </button>
                    <button
                      className={`${styles.dropdownItem} ${styles.dropdownDanger}`}
                      onClick={() => setConfirmId(cid)}
                      data-testid={`delete-calendar-${cid}`}
                    >
                      Delete calendar
                    </button>
                  </div>
                )}

                {confirmId === cid && (
                  <div className={styles.confirmBox} data-testid="confirm-delete">
                    <p className={styles.confirmText}>
                      Delete <strong>{calendarLabel(cid)}</strong> from this
                      node? Its events are removed here. Peers who joined keep
                      their own copy.
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
                        onClick={() => removeCalendar(cid, "delete")}
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
      </main>
    </div>
  );
}
