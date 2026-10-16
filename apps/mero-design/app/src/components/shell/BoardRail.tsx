import { useRef, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import { useToast } from "../../contexts/ToastContext";
import { extractErrorMessage, humanizeError } from "../../utils/errorMessage";
import ProjectThumbnail from "../ProjectThumbnail";
import { IconGrid, IconMore, IconPlus } from "../HomeIcons";
import type { Project } from "../../types";
import { useShell } from "./shellContext";
import styles from "./DesignShell.module.css";

/**
 * The left rail: the current team's boards, always one click away. Replaces
 * the projects page as the way between boards — no more back to a list and
 * into the next one.
 */
export default function BoardRail({
  onNavigate,
  onDelete,
}: {
  /** Called after any navigation, so the mobile drawer can close. */
  onNavigate?: () => void;
  onDelete: (board: Project) => void;
}) {
  const { teamId, projectId, boards, openBoard, openTeam, openSettings } = useShell();
  const { isDelegated } = useMero();
  const { showToast } = useToast();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Escape cancels a rename; the blur that follows must not save it.
  const cancelRename = useRef(false);

  if (!teamId) return null;
  const listed = boards.listedFor === teamId;

  async function create() {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const board = await boards.createBoard(name);
      setNewName("");
      setAdding(false);
      openBoard(board.contextId);
      onNavigate?.();
    } catch (err) {
      // Surface node rejections (e.g. the namespace-admin gate on subgroup
      // creation) instead of failing silently in the network console.
      showToast(humanizeError(extractErrorMessage(err, "Could not create board.")));
    } finally {
      setCreating(false);
    }
  }

  async function rename(board: Project) {
    const name = renameDraft.trim();
    setRenaming(null);
    if (!name || name === board.name) return;
    try {
      await boards.renameBoard(board, name);
    } catch (err) {
      showToast(extractErrorMessage(err, "Could not rename board."));
    }
  }

  return (
    <nav className={styles.railInner} aria-label="Boards">
      <button
        type="button"
        className={`${styles.railHome} ${!projectId ? styles.railRowActive : ""}`}
        onClick={() => { openTeam(teamId); onNavigate?.(); }}
        data-testid="rail-team-home"
      >
        <IconGrid />
        <span>All boards</span>
        {listed && <span className={styles.railCount}>{boards.boards.length}</span>}
      </button>

      <div className={styles.railHead}>
        <span>Boards</span>
        <button
          type="button"
          className={styles.railAdd}
          onClick={() => setAdding((v) => !v)}
          title="New board"
          aria-label="New board"
          aria-expanded={adding}
          data-testid="new-board-btn"
        >
          <IconPlus size={15} />
        </button>
      </div>

      {adding && (
        <div className={styles.railField}>
          <input
            autoFocus
            className={styles.inlineInput}
            placeholder="Board name…"
            aria-label="New board name"
            value={newName}
            maxLength={80}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
              if (e.key === "Escape") setAdding(false);
            }}
            data-testid="rail-new-board-input"
          />
          <button
            type="button"
            className={styles.inlineBtn}
            onClick={() => void create()}
            disabled={creating || !newName.trim()}
            data-testid="rail-create-board-btn"
          >
            {creating ? "…" : "Create"}
          </button>
        </div>
      )}

      <div className={styles.railList}>
        {!listed && boards.boards.length === 0 && (
          <>
            <div className={styles.railSkeleton} />
            <div className={styles.railSkeleton} />
          </>
        )}
        {listed && boards.boards.length === 0 && !adding && (
          <p className={styles.railEmpty}>No boards yet. Press + to make the first one.</p>
        )}
        {boards.boards.map((b) => {
          const name = b.name || b.contextId.slice(0, 8);
          const active = b.contextId === projectId;
          const menuOpen = menuFor === b.contextId;
          if (renaming === b.contextId) {
            return (
              <div key={b.contextId} className={styles.railField}>
                <input
                  autoFocus
                  className={styles.inlineInput}
                  aria-label="Board name"
                  value={renameDraft}
                  maxLength={80}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Saving happens on blur, so Enter and clicking away are one path.
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      cancelRename.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  onBlur={() => {
                    if (cancelRename.current) {
                      cancelRename.current = false;
                      setRenaming(null);
                      return;
                    }
                    void rename(b);
                  }}
                  data-testid={`rename-input-${b.contextId}`}
                />
              </div>
            );
          }
          return (
            <div key={b.contextId} className={styles.railItem}>
              <div className={`${styles.railRow} ${active ? styles.railRowActive : ""}`}>
                <button
                  type="button"
                  className={styles.railBoard}
                  onClick={() => { setMenuFor(null); openBoard(b.contextId); onNavigate?.(); }}
                  aria-current={active ? "page" : undefined}
                  title={name}
                  data-testid={`rail-board-${b.contextId}`}
                >
                  <ProjectThumbnail contextId={b.contextId} name={name} className={styles.railThumb} testId="rail" />
                  <span className={styles.railName}>{name}</span>
                </button>
                <button
                  type="button"
                  className={styles.railMore}
                  onClick={() => setMenuFor(menuOpen ? null : b.contextId)}
                  aria-label={`More for ${name}`}
                  aria-expanded={menuOpen}
                  title="More options"
                  data-testid={`board-menu-${b.contextId}`}
                >
                  <IconMore />
                </button>
              </div>
              {menuOpen && (
                <div className={styles.railActions} role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuFor(null); setRenameDraft(name); setRenaming(b.contextId); }}
                    data-testid={`board-rename-${b.contextId}`}
                  >Rename</button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setMenuFor(null); openSettings("board", b.contextId); onNavigate?.(); }}
                    data-testid={`board-settings-${b.contextId}`}
                  >Settings</button>
                  {/* Deleting a context is a node's own operation; an
                      account's relay has no form of it. */}
                  {!isDelegated && (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.danger}
                      onClick={() => { setMenuFor(null); onDelete(b); }}
                      data-testid={`board-delete-${b.contextId}`}
                    >Delete</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
