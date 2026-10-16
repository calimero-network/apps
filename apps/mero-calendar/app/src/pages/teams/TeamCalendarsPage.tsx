import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  JOIN_SYNC_POLL_MS,
  JoinSyncBanner,
  isNamespaceJustJoined,
  useJoinSync,
  useMero,
} from "@calimero-network/mero-react";
import {
  listContextsForApplication,
  listGroupContexts,
  listNamespaces,
  listSubgroupIds,
  selfIsGroupAdmin,
  setContextName,
} from "../../api/admin";
import { loadAccountId } from "../../api/identity";
import {
  contextId as readContextId,
  contextName as readContextName,
  namespaceId as readNamespaceId,
} from "../../api/appScope";
import TeamMembersPanel from "./TeamMembersPanel";
import { useEnsureAppId } from "../../hooks/useEnsureAppId";
import CalendarLogo from "../../components/common/logo/CalendarLogo";
import ThemeToggle from "../../components/common/theme-toggle/ThemeToggle";
import LogoutButton from "../../components/common/logout-button/LogoutButton";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import {
  calendarLabel,
  clearStoredCalendarName,
  getStoredCalendarName,
  setStoredCalendarName,
  useTeamName,
} from "../../utils/teamName";
import { useClickOutside } from "../../hooks/useClickOutside";
import { joinCalendarWithRetry } from "../../api/joinCalendar";
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
  const { admin, isDelegated } = useMero();
  const teamName = useTeamName(teamId);

  const [calendars, setCalendars] = useState<string[]>([]);
  /**
   * contextId → the name core replicated to us.
   *
   * Kept separate from `calendars` so the list order is untouched, and read
   * through `nameOf` below rather than directly, because a calendar created
   * before names were replicated has no entry here at all.
   */
  const [names, setNames] = useState<Record<string, string>>({});
  /** contextId → the group it hangs off: its subgroup, or the team itself. */
  const [groupOf, setGroupOf] = useState<Record<string, string>>({});
  /** contextId → this session is an Admin of the team or of its subgroup. */
  const [adminOf, setAdminOf] = useState<Record<string, boolean>>({});
  const [membersOpen, setMembersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  /**
   * The team whose calendar list has come back from the node, empty or not.
   * Not `!loading`: a failed load also ends loading, and that is no answer.
   */
  const [listedFor, setListedFor] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // An open in progress stops retrying its join once the page is gone.
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
    };
  }, []);

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
   *
   * Except when the team is one of this application's own namespaces: core
   * runs every context in a namespace on its target application (a create
   * naming another one is overridden, and subgroups inherit the root's
   * target), so there everything its groups hold IS a calendar. That case has
   * to skip the intersection, because `/contexts/for-application` lists only
   * the contexts this node has joined — none, for a member who has just
   * joined the team — and a calendar missing from the list can't be opened,
   * which is what joins it.
   */
  const load = useCallback(async () => {
    const appId = await ensureAppId();
    const client = requireAdmin();

    // `null` means "do not filter": a namespace is bound to one application by
    // core, so on an account — whose node-wide context listing is not a thing
    // the relay answers — everything the team's groups hold IS a calendar.
    let calendarIds: Set<string> | null = null;
    if (!isDelegated) {
      let teamIsOurs = false;
      try {
        const ours = await listNamespaces(client, appId);
        teamIsOurs = ours.some((ns) => readNamespaceId(ns) === teamId);
      } catch {
        /* unknown — fall back to the calendars this node holds */
      }
      if (!teamIsOurs) {
        try {
          const appContexts = await listContextsForApplication(client, appId);
          calendarIds = new Set(appContexts.map(readContextId).filter(Boolean));
        } catch {
          calendarIds = new Set();
        }
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

    // Who may delete each calendar: a team Admin, or an Admin of the
    // calendar's own subgroup — the two core lets `deleteGroup` through for.
    const self = await loadAccountId(client);
    const teamAdmin = await selfIsGroupAdmin(client, teamId, self);
    const subgroupAdmin: Record<string, boolean> = {};
    if (!teamAdmin) {
      for (const gid of new Set(visible.map((id) => ownerGroup[id]))) {
        if (gid && gid !== teamId) {
          subgroupAdmin[gid] = await selfIsGroupAdmin(client, gid, self);
        }
      }
    }
    const admins: Record<string, boolean> = {};
    for (const id of visible) {
      admins[id] = teamAdmin || !!subgroupAdmin[ownerGroup[id]];
    }

    setCalendars(visible);
    setNames(found);
    setGroupOf(ownerGroup);
    setAdminOf(admins);
    setLoading(false);
    setListedFor(teamId);

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

  // A team just joined from an invitation link holds the invitation dialog on
  // "Syncing…" until this page has read its calendars. An EMPTY read settles
  // only once the team is no longer just-joined: until then it is what a node
  // that has not synced the team returns. The watchdog clears the flag, after
  // which a team with no calendars reads as empty again.
  const { isSyncing, dismiss: dismissSyncing } = useJoinSync({
    namespaceId: teamId || null,
    settled:
      listedFor === teamId &&
      (calendars.length > 0 || !isNamespaceJustJoined(teamId || null)),
    // Still empty: let the gate wait up to its ceiling, not the base window.
    active: calendars.length === 0,
  });

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
    // While the join-sync gate is up the team's calendars are on their way, so
    // re-read at its pace rather than every 30 s.
    const timer = setInterval(run, isSyncing ? JOIN_SYNC_POLL_MS : 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [admin, load, isSyncing]);

  async function createCalendar() {
    const name = newName.trim() || teamName;
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

  // Opening a calendar joins it first. Right after the team join the node may
  // not hold that calendar yet and refuses the join; opening it anyway failed
  // the calendar page's first read. The join is retried, and only a calendar
  // the node has joined is opened.
  async function openCalendar(contextId: string) {
    setBusyId(contextId);
    try {
      const admin = requireAdmin();
      await joinCalendarWithRetry(
        () => admin.joinContext(contextId),
        teamId || null,
        () => unmounted.current,
      );
      navigate(`/teams/${teamId}/calendar/${contextId}`);
    } catch (err) {
      if (unmounted.current) return;
      showToast(
        humanizeError(extractErrorMessage(err, "Could not open this calendar.")),
      );
    } finally {
      if (!unmounted.current) setBusyId(null);
    }
  }

  /** The subgroup a calendar lives in, or "" when it hangs off the team itself. */
  const subgroupOf = (cid: string) => {
    const gid = groupOf[cid];
    return gid && gid !== teamId ? gid : "";
  };

  /**
   * Admins delete a calendar; anyone else may leave it (on a node).
   *
   * Delete removes the calendar for the whole team: a calendar is a subgroup
   * holding one context, and core's `deleteGroup` on that subgroup cascades to
   * the context. It is allowed to a team Admin or the subgroup's Admin, and has
   * an account form. `deleteContext` is NOT the way: the app's token carries no
   * `context:delete` (the node answers 403), and on an account it is refused by
   * name. It remains only for a calendar created straight in the team (no
   * subgroup), on a node.
   */
  const canDelete = (cid: string) =>
    !!adminOf[cid] && (!!subgroupOf(cid) || !isDelegated);

  /**
   * `leave` stops this node syncing the calendar and keeps the group's copy.
   * It is a NODE's own operation (an account has nothing local to opt out of,
   * and the account admin refuses it by name), and is not offered to an Admin,
   * who deletes instead.
   */
  const canLeave = (cid: string) => !isDelegated && adminOf[cid] === false;

  async function removeCalendar(contextId: string, mode: "delete" | "leave") {
    setConfirmId(null);
    setMenuOpenId(null);
    setBusyId(contextId);
    try {
      if (mode === "delete") {
        const subgroup = subgroupOf(contextId);
        if (subgroup) {
          // The group delete only unregisters the context (its data stays on
          // the node), so the context goes first where it can. Best-effort: an
          // app token has no `context:delete` and an account has no form of it.
          await requireAdmin().deleteContext(contextId).catch(() => {});
          await requireAdmin().deleteGroup(subgroup);
        } else {
          await requireAdmin().deleteContext(contextId);
        }
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
      // Not `humanizeError`: its copy is about creating a calendar, and would
      // turn a refused delete into "You don't have permission to create…".
      showToast(
        extractErrorMessage(
          err,
          mode === "delete"
            ? "Could not delete the calendar."
            : "Could not leave the calendar.",
        ),
      );
    } finally {
      setBusyId(null);
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

        {isSyncing && calendars.length === 0 ? (
          <JoinSyncBanner show what="calendars" onDismiss={dismissSyncing} />
        ) : loading ? (
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

                {/* Only rendered when there is something to offer (see
                    canDelete / canLeave above). */}
                {(canDelete(cid) || canLeave(cid)) && (
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

                {menuOpenId === cid && (canDelete(cid) || canLeave(cid)) && (
                  <div className={styles.dropdown} ref={menuRef}>
                    {canLeave(cid) && (
                      <button
                        className={styles.dropdownItem}
                        onClick={() => removeCalendar(cid, "leave")}
                        data-testid={`leave-calendar-${cid}`}
                      >
                        Leave calendar
                      </button>
                    )}
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
                      {subgroupOf(cid) ? (
                        <>
                          Delete <strong>{nameOf(cid)}</strong> for everyone in
                          this team? Its events are removed for all members.
                        </>
                      ) : (
                        <>
                          Delete <strong>{nameOf(cid)}</strong> from this
                          node? Its events are removed here. Peers who joined
                          keep their own copy.
                        </>
                      )}
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
