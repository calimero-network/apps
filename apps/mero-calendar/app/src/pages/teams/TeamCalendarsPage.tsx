import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import {
  listContextsForApplication,
  listGroupContexts,
  listSubgroupIds,
  setContextName,
} from "../../api/admin";
import {
  contextId as readContextId,
  contextName as readContextName,
} from "../../api/appScope";
import TeamMembersPanel from "./TeamMembersPanel";
import { useEnsureAppId } from "../../hooks/useEnsureAppId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import {
  calendarLabel,
  clearStoredCalendarName,
  getStoredCalendarName,
  setStoredCalendarName,
  teamLabel,
} from "../../utils/teamName";
import { useClickOutside } from "../../hooks/useClickOutside";
import styles from "./teams.module.scss";

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
  // `admin`, not `mero.admin`: the session-aware client (see TeamsPage). On an
  // account, `createGroupInNamespace`/`createContext` are delegated creation
  // through the relay; the raw client's node routes answer 403 there.
  const { admin, isDelegated, logout } = useMero();

  const [calendars, setCalendars] = useState<string[]>([]);
  /**
   * contextId → the name core replicated to us.
   *
   * Kept separate from `calendars` so the list order is untouched, and read
   * through `nameOf` below rather than directly, because a calendar created
   * before names were replicated has no entry here at all.
   */
  const [names, setNames] = useState<Record<string, string>>({});
  const [membersOpen, setMembersOpen] = useState(false);
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
  const ensureAppId = useEnsureAppId();

  /** The session-aware admin, or a clear refusal before anything is sent. */
  const requireAdmin = useCallback(() => {
    if (!admin) throw new Error("Not connected.");
    return admin;
  }, [admin]);

  /** The subgroups of this team, plus the team itself: contexts hang off both. */
  const teamGroupIds = useCallback(async (): Promise<string[]> => {
    const ids = new Set<string>([teamId]);
    try {
      for (const id of await listSubgroupIds(requireAdmin(), teamId)) ids.add(id);
    } catch {
      /* no subgroups yet — the team itself is still worth checking */
    }
    return [...ids];
  }, [teamId, requireAdmin]);

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
    const client = requireAdmin();

    // `null` means "do not filter": a namespace is bound to one application by
    // core, so on an account — whose node-wide context listing is not a thing
    // the relay answers — everything the team's groups hold IS a calendar.
    let calendarIds: Set<string> | null = null;
    if (!isDelegated) {
      try {
        const appContexts = await listContextsForApplication(client, appId);
        calendarIds = new Set(appContexts.map(readContextId).filter(Boolean));
      } catch {
        calendarIds = new Set();
      }
    }

    const groupIds = await teamGroupIds();
    const inTeam = new Set<string>();
    const found: Record<string, string> = {};
    // Which group each calendar hangs off — a metadata write is addressed to
    // the group that owns the context, not to the team root, so the backfill
    // below has to remember where each one was seen.
    const ownerGroup: Record<string, string> = {};
    for (const gid of groupIds) {
      try {
        for (const ctx of await listGroupContexts(client, gid)) {
          const id = readContextId(ctx);
          if (!id) continue;
          inTeam.add(id);
          ownerGroup[id] = gid;
          const name = readContextName(ctx);
          if (name) found[id] = name;
        }
      } catch {
        /* a group we can't read contributes nothing */
      }
    }

    const visible = [...inTeam].filter(
      (id) => calendarIds === null || calendarIds.has(id),
    );
    setCalendars(visible);
    setNames(found);
    setLoading(false);

    // ── Backfill ───────────────────────────────────────────────────────────
    // Calendars created before names were replicated have one only in the
    // creator's localStorage. Whoever still holds that cached name publishes it
    // so every other member stops seeing a raw id. Silent and best-effort: a
    // member without `CAN_MANAGE_METADATA` is refused, which is correct and not
    // worth a toast — somebody who can will heal it on their next visit.
    for (const id of visible) {
      if (found[id]) continue;
      const cached = getStoredCalendarName(id);
      if (!cached) continue;
      const gid = ownerGroup[id] ?? teamId;
      try {
        await setContextName(client, gid, id, cached.slice(0, 64));
        setNames((prev) => ({ ...prev, [id]: cached }));
      } catch {
        /* not permitted, or the node is older — the label still falls back */
      }
    }
  }, [ensureAppId, isDelegated, requireAdmin, teamGroupIds, teamId]);

  /** Best label for a calendar: replicated name → cached name → id stub. */
  const nameOf = useCallback(
    (cid: string) => calendarLabel(cid, names[cid]),
    [names],
  );

  useEffect(() => {
    if (!admin) return;
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
  }, [admin, load]);

  async function createCalendar() {
    const name = newName.trim() || teamLabel(teamId, "");
    setCreating(true);
    try {
      const appId = await ensureAppId();
      if (!appId) {
        showToast("Select or install the Mero Calendar application first.");
        return;
      }

      const client = requireAdmin();
      // `CreateGroupInNamespaceBody` accepts `groupName` and `visibility`,
      // nothing else, and is `deny_unknown_fields` — so an extra key is a 400
      // for the whole create. Open, so every team member can follow the
      // calendar without being added to it one by one.
      const sgData = (await client.createGroupInNamespace(teamId, {
        groupName: name,
        visibility: "open",
      })) as { groupId?: string; group_id?: string; id?: string };
      const subgroupId = sgData.groupId ?? sgData.group_id ?? sgData.id ?? "";
      if (subgroupId) {
        // Older nodes ignore `visibility` on create; say it again explicitly.
        await client
          .setSubgroupVisibility(subgroupId, { subgroupVisibility: "open" })
          .catch(() => {});
      }

      // The calendar contract's init() takes no args → empty init params.
      // `CreateContextRequest` is `deny_unknown_fields` and accepts only
      // applicationId / serviceName / contextSeed / initializationParams /
      // groupId / identitySecret / name.
      const ctxData = (await client.createContext({
        applicationId: appId,
        groupId: subgroupId || teamId,
        name,
        initializationParams: [],
      })) as { contextId?: string; id?: string };
      const contextId = ctxData.contextId ?? ctxData.id ?? "";
      if (!contextId) throw new Error("The node created no calendar.");

      setStoredCalendarName(contextId, name);
      // The create already carries `name`, but only for the group it was
      // created in; setting it explicitly also covers the node that created the
      // subgroup a moment ago and makes the failure visible in one place.
      await setContextName(client, subgroupId || teamId, contextId, name.slice(0, 64))
        .catch(() => {});
      setNewName("");
      await client.joinContext(contextId).catch(() => {});
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
      await requireAdmin().joinContext(contextId).catch(() => {});
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
   *
   * Both are a NODE's own operations: an account has no local copy to drop and
   * nothing local to opt out of, and the account admin refuses both by name
   * (`NotForAccountError`). The menu that offers them is not rendered for an
   * account at all.
   */
  async function removeCalendar(contextId: string, mode: "delete" | "leave") {
    setConfirmId(null);
    setMenuOpenId(null);
    setBusyId(contextId);
    try {
      if (mode === "delete") {
        await requireAdmin().deleteContext(contextId);
        clearStoredCalendarName(contextId);
      } else {
        await requireAdmin().leaveContext(contextId);
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
    navigate("/");
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

        <div className={styles.titleRow}>
          <h1 className={styles.title}>{teamLabel(teamId, "")}</h1>
          <button
            className="mc-btn"
            onClick={() => setMembersOpen(true)}
            data-testid="open-members"
          >
            Members
          </button>
        </div>
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
                  <span className={styles.cardName}>{nameOf(cid)}</span>
                  <span className={styles.cardSub}>{cid.slice(0, 12)}…</span>
                </button>

                {/* Leave and Delete are a node's own operations (see
                    removeCalendar); an account is not offered the menu. */}
                {!isDelegated && (
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

                {!isDelegated && menuOpenId === cid && (
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
                      Delete <strong>{nameOf(cid)}</strong> from this
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

      {membersOpen && (
        <TeamMembersPanel teamId={teamId} onClose={() => setMembersOpen(false)} />
      )}
    </div>
  );
}
