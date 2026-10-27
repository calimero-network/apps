import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Outlet, useLocation, useMatch, useNavigate, useSearchParams } from "react-router-dom";
import { JoinSyncBanner, useJoinSync, useMero } from "@calimero-apps/cloud";
import { getNodeIdentity } from "../../api/rpc";
import { useTeamList } from "../../hooks/useTeamList";
import { useBoardList } from "../../hooks/useBoardList";
import { useIsGroupAdmin } from "../../hooks/useIsGroupAdmin";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage } from "../../utils/errorMessage";
import { forgetBoard, rememberBoard, rememberTeam } from "../../utils/lastVisit";
import { useTeamName } from "../../utils/teamName";
import type { Project } from "../../types";
import Logo from "../Logo";
import ThemeToggle from "../ThemeToggle";
import InviteModal from "../InviteModal";
import SettingsPanel from "../SettingsPanel";
import ConfirmDialog from "../ConfirmDialog";
import { IconMenu, IconPanel, IconUserPlus } from "../HomeIcons";
import BoardRail from "./BoardRail";
import TeamSwitcher from "./TeamSwitcher";
import UserMenu from "./UserMenu";
import { ShellContext, type SettingsSection, type ShellValue } from "./shellContext";
import styles from "./DesignShell.module.css";

const RAIL_KEY = "mero-design:rail";

function readRailOpen(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== "closed";
  } catch {
    return true;
  }
}

/**
 * The one frame every signed-in screen sits in.
 *
 *   ┌ top bar ──────────────────────────────────────────────────────────────┐
 *   │ ☰ logo  Team ▾  / Board          [live members ▶ Present] Invite ◐ (A)│
 *   ├ rail ───────┬ main ─────────────────────────────────────┬ settings ──┤
 *   │ All boards  │ the board (toolbar, canvas, inspector)     │ ?settings= │
 *   │ ▢ Board one │ — or the team's home grid                  │            │
 *   │ ▢ Board two │                                            │            │
 *   └─────────────┴────────────────────────────────────────────┴────────────┘
 *
 * It replaced three pages that each drew their own header (teams list →
 * projects + invitations tabs → board with a back arrow): switching team or
 * board, inviting and settings are all reachable from wherever you are. On a
 * phone the rail is a drawer behind the menu button.
 *
 * ⚠️ The top bar and the rail are frosted (`backdrop-filter`), which makes each
 * the containing block for a `position: fixed` descendant. Dialogs portal to
 * <body>; the drawer is a portal too.
 */
export default function DesignShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const { showToast } = useToast();
  const { logout, nodeUrl } = useMero();

  const teamMatch = useMatch("/teams/:teamId/*");
  const boardMatch = useMatch("/teams/:teamId/projects/:projectId");
  const teamId = teamMatch?.params.teamId ?? null;
  const projectId = boardMatch?.params.projectId ?? null;

  const teams = useTeamList();
  const boards = useBoardList(teamId);
  const listedTeamName = teams.teams.find((t) => t.groupId === teamId)?.name;
  const teamName = useTeamName(teamId ?? undefined, listedTeamName);
  const currentBoard = boards.boards.find((b) => b.contextId === projectId) ?? null;

  const narrow = useMediaQuery(NARROW_QUERY);
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [boardSlot, setBoardSlot] = useState<HTMLElement | null>(null);
  const [account, setAccount] = useState("");
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [leavingTeam, setLeavingTeam] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getNodeIdentity()
      .then((me) => { if (!cancelled) setAccount(me.accountId ?? ""); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const isTeamAdmin = useIsGroupAdmin(teamId, account);

  // Going somewhere closes the drawer; so does widening past it.
  useEffect(() => setDrawerOpen(false), [location.pathname, narrow]);

  // Remember where you are, for the next open (utils/lastVisit). Written as
  // soon as a screen opens; every read checks it against what the node lists,
  // so a typo'd or stale URL is never resumed into.
  useEffect(() => {
    if (!teamId) return;
    if (projectId) rememberBoard(nodeUrl, teamId, projectId);
    else rememberTeam(nodeUrl, teamId);
  }, [teamId, projectId, nodeUrl]);

  // A team just joined by invitation has not replicated yet; the invitation
  // dialog holds "Syncing…", and this banner shows, until the team's boards
  // have been read. An empty list counts (a new team has none); a failed read
  // does not, and the 30 s poll tries again.
  const joinSync = useJoinSync({ namespaceId: teamId, settled: !!teamId && boards.listedFor === teamId });

  const toggleRail = useCallback(() => {
    if (narrow) {
      setDrawerOpen((v) => !v);
      return;
    }
    setRailOpen((v) => {
      try { localStorage.setItem(RAIL_KEY, v ? "closed" : "open"); } catch { /* fine */ }
      return !v;
    });
  }, [narrow]);

  const settings = params.get("settings");
  const settingsSection: SettingsSection | null =
    settings === "team" || settings === "board" ? settings : null;
  const settingsBoardId = params.get("board") || projectId;
  const settingsBoard = boards.boards.find((b) => b.contextId === settingsBoardId) ?? null;

  const openTeam = useCallback((id: string, opts?: { resume?: boolean }) => {
    navigate(`/teams/${id}/projects`, opts?.resume ? { state: { resume: true } } : undefined);
  }, [navigate]);

  const openBoard = useCallback((contextId: string) => {
    if (!teamId) return;
    navigate(`/teams/${teamId}/projects/${contextId}`);
  }, [navigate, teamId]);

  const openSettings = useCallback((section: SettingsSection, board?: string) => {
    const next = new URLSearchParams(params);
    next.set("settings", section);
    if (section === "board" && board && board !== projectId) next.set("board", board);
    else next.delete("board");
    setParams(next);
  }, [params, projectId, setParams]);

  const closeSettings = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("settings");
    next.delete("board");
    setParams(next);
  }, [params, setParams]);

  const setSection = useCallback((section: SettingsSection) => {
    openSettings(section, section === "board" ? settingsBoardId ?? undefined : undefined);
  }, [openSettings, settingsBoardId]);

  const openInvite = useCallback(() => setInviteOpen(true), []);

  async function confirmDeleteBoard(board: Project) {
    setDeleting(null);
    try {
      await boards.deleteBoard(board);
    } catch (err) {
      // The board stays listed: a refusal (e.g. a token without
      // `context:delete` answering 403) must not look like a delete.
      showToast(extractErrorMessage(err, "Could not delete board."));
      return;
    }
    if (teamId) forgetBoard(nodeUrl, teamId, board.contextId);
    showToast(`Deleted “${board.name}”.`, "success");
    if (board.contextId === projectId || board.contextId === params.get("board")) {
      navigate(`/teams/${teamId}/projects`, { replace: true });
    }
  }

  async function confirmDeleteTeam() {
    setDeletingTeam(false);
    if (!teamId) return;
    try {
      await teams.deleteTeam(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not delete team."));
      return;
    }
    navigate("/teams", { replace: true });
  }

  async function confirmLeaveTeam() {
    setLeavingTeam(false);
    if (!teamId) return;
    try {
      await teams.leaveTeam(teamId);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not leave team."));
      return;
    }
    showToast(`Left ${teamName}.`, "success");
    navigate("/teams", { replace: true });
  }

  async function renameBoard(board: Project, name: string) {
    try {
      await boards.renameBoard(board, name);
      showToast("Board renamed.", "success");
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not rename board."));
    }
  }

  function handleLogout() {
    logout();
    navigate("/");
  }

  const value = useMemo<ShellValue>(
    () => ({ teamId, projectId, teams, boards, isTeamAdmin, openTeam, openBoard, openInvite, openSettings, boardSlot }),
    [teamId, projectId, teams, boards, isTeamAdmin, openTeam, openBoard, openInvite, openSettings, boardSlot],
  );

  const rail = <BoardRail onNavigate={() => setDrawerOpen(false)} onDelete={setDeleting} />;
  const showRail = !!teamId && !narrow && railOpen;

  return (
    <ShellContext.Provider value={value}>
      <div className={styles.frame} data-testid="design-shell">
        <header className={styles.topbar}>
          {teamId && (
            <button
              type="button"
              className={styles.iconBtn}
              onClick={toggleRail}
              aria-label={narrow ? "Open boards" : railOpen ? "Hide boards" : "Show boards"}
              aria-expanded={narrow ? drawerOpen : railOpen}
              title={narrow ? "Boards" : railOpen ? "Hide boards" : "Show boards"}
              data-testid="rail-toggle"
            >
              {narrow ? <IconMenu /> : <IconPanel />}
            </button>
          )}
          <span className={styles.brand}>
            <Logo size={28} />
            <span className={styles.brandText}>Mero Design</span>
          </span>
          <span className={styles.sep} aria-hidden="true" />
          <TeamSwitcher currentName={teamName} />
          {projectId && (
            <>
              <span className={styles.crumbSep} aria-hidden="true">/</span>
              <span className={styles.crumb} title={currentBoard?.name} data-testid="board-crumb">
                {currentBoard?.name ?? ""}
              </span>
            </>
          )}

          <div className={styles.topbarEnd}>
            {/* The open board portals its live members and Present here. */}
            <div className={styles.boardSlot} ref={setBoardSlot} />
            {teamId && (
              <button
                type="button"
                className={styles.inviteBtn}
                onClick={openInvite}
                title={`Invite people to ${teamName}`}
                data-testid="invite-btn"
              >
                <IconUserPlus />
                <span className={styles.inviteLabel}>Invite</span>
              </button>
            )}
            <ThemeToggle className={styles.iconBtn} />
            <UserMenu account={account} onLogout={handleLogout} />
          </div>
        </header>

        <div className={styles.body}>
          {showRail && <aside className={styles.rail}>{rail}</aside>}

          <main className={styles.main}>
            {joinSync.isSyncing && (
              <JoinSyncBanner
                show
                what="boards"
                onDismiss={joinSync.dismiss}
                className={styles.syncBanner}
              />
            )}
            <Outlet />
          </main>

          {teamId && settingsSection && (
            <SettingsPanel
              section={settingsSection}
              teamId={teamId}
              teamName={teamName}
              board={settingsBoard}
              boardPending={!settingsBoard && !!settingsBoardId && boards.listedFor !== teamId}
              account={account}
              isTeamAdmin={isTeamAdmin}
              onSection={setSection}
              onClose={closeSettings}
              onRenameBoard={renameBoard}
              onDeleteBoard={setDeleting}
              onDeleteTeam={() => setDeletingTeam(true)}
              onLeaveTeam={() => setLeavingTeam(true)}
            />
          )}
        </div>

        {narrow && drawerOpen && teamId &&
          createPortal(
            <div className={styles.drawer} onClick={() => setDrawerOpen(false)}>
              <div
                className={styles.drawerPanel}
                role="dialog"
                aria-modal="true"
                aria-label="Boards"
                data-testid="mobile-nav"
                onClick={(e) => e.stopPropagation()}
              >
                {rail}
              </div>
            </div>,
            document.body,
          )}
      </div>

      {inviteOpen && teamId && (
        <InviteModal teamId={teamId} teamName={teamName} onClose={() => setInviteOpen(false)} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete board?"
          message={`“${deleting.name}” will be deleted for everyone in ${teamName}. This cannot be undone.`}
          confirmLabel="Delete board"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDeleteBoard(deleting)}
        />
      )}
      {deletingTeam && (
        <ConfirmDialog
          title="Delete team?"
          message={`${teamName} and its boards will be removed from this node. Other members keep their copies.`}
          confirmLabel="Delete team"
          destructive
          onCancel={() => setDeletingTeam(false)}
          onConfirm={() => void confirmDeleteTeam()}
        />
      )}
      {leavingTeam && (
        <ConfirmDialog
          title="Leave team?"
          message={`You will lose access to ${teamName} and its boards. You will need a new invitation to return.`}
          confirmLabel="Leave team"
          destructive
          onCancel={() => setLeavingTeam(false)}
          onConfirm={() => void confirmLeaveTeam()}
        />
      )}
    </ShellContext.Provider>
  );
}
