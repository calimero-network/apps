import { useEffect, useState } from "react";
import { useMero } from "@calimero-network/mero-react";
import SettingsSection from "./SettingsSection";
import { IconClose } from "./HomeIcons";
import type { Project } from "../types";
import type { SettingsSection as Section } from "./shell/shellContext";
import styles from "./SettingsPanel.module.css";

interface Props {
  section: Section;
  teamId: string;
  teamName: string;
  /** The board in scope (the open one, or the one whose ⋯ → Settings was used). */
  board: Project | null;
  /** True while the board's listing has not come back yet. */
  boardPending: boolean;
  onSection: (section: Section) => void;
  onClose: () => void;
  onRenameBoard: (board: Project, name: string) => Promise<void>;
  onDeleteBoard: (board: Project) => void;
  onDeleteTeam: () => void;
}

/**
 * Settings, inside the shell rather than over it: a panel at the side of the
 * board or the team home, addressed by the URL (`?settings=team|board`), so a
 * reload, Back, or a link someone pastes lands on the same screen.
 *
 * Two sections: the team (its members and your name in it) and the board in
 * scope (its name, its canvas access).
 */
export default function SettingsPanel({
  section,
  teamId,
  teamName,
  board,
  boardPending,
  onSection,
  onClose,
  onRenameBoard,
  onDeleteBoard,
  onDeleteTeam,
}: Props) {
  const { isDelegated } = useMero();
  const hasBoard = !!board || boardPending;
  const shown: Section = section === "board" && hasBoard ? "board" : "team";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      // A confirm opened from the panel owns its own Escape.
      if (document.querySelector('[role="alertdialog"]')) return;
      // Ahead of the board's own Escape handling, which would act on the canvas.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <aside className={styles.panel} aria-label="Settings" data-testid="settings-panel">
      <header className={styles.head}>
        <h2 className={styles.title}>Settings</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close settings" data-testid="settings-close">
          <IconClose />
        </button>
      </header>

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={shown === "team"}
          className={`${styles.tab} ${shown === "team" ? styles.tabActive : ""}`}
          onClick={() => onSection("team")}
          data-testid="settings-tab-team"
        >Team</button>
        {hasBoard && (
          <button
            type="button"
            role="tab"
            aria-selected={shown === "board"}
            className={`${styles.tab} ${shown === "board" ? styles.tabActive : ""}`}
            onClick={() => onSection("board")}
            data-testid="settings-tab-board"
          >Board</button>
        )}
      </div>

      <div className={styles.body}>
        {shown === "team" ? (
          <>
            <h3 className={styles.sectionTitle} title={teamName}>{teamName}</h3>
            <SettingsSection key={teamId} type="team" id={teamId} name={teamName} />
            {/* Deleting a namespace is a node's own operation; an account's
                relay has no form of it. */}
            {!isDelegated && (
              <div className={styles.danger}>
                <div>
                  <strong>Delete team</strong>
                  <span>Removes the team and its boards from this node.</span>
                </div>
                <button type="button" className={styles.dangerBtn} onClick={onDeleteTeam} data-testid="delete-team-btn">
                  Delete
                </button>
              </div>
            )}
          </>
        ) : board ? (
          <>
            <BoardName key={board.contextId} board={board} onRename={onRenameBoard} />
            <SettingsSection
              key={board.contextId}
              type="project"
              id={board.contextId}
              groupId={board.groupId}
              namespaceId={teamId}
              name={board.name || board.contextId.slice(0, 8)}
            />
            {!isDelegated && (
              <div className={styles.danger}>
                <div>
                  <strong>Delete board</strong>
                  <span>Everyone in the team loses it. This cannot be undone.</span>
                </div>
                <button type="button" className={styles.dangerBtn} onClick={() => onDeleteBoard(board)} data-testid="delete-board-btn">
                  Delete
                </button>
              </div>
            )}
          </>
        ) : (
          <p className={styles.muted}>Loading board…</p>
        )}
      </div>
    </aside>
  );
}

/** The board's name, editable in place. */
function BoardName({ board, onRename }: { board: Project; onRename: (board: Project, name: string) => Promise<void> }) {
  const [draft, setDraft] = useState(board.name);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(board.name), [board.name]);
  const trimmed = draft.trim();
  const unchanged = !trimmed || trimmed === board.name;

  async function save() {
    if (unchanged || saving) return;
    setSaving(true);
    try {
      await onRename(board, trimmed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.nameRow}>
      <label className={styles.label} htmlFor="board-name-input">Board name</label>
      <div className={styles.field}>
        <input
          id="board-name-input"
          className={styles.input}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
          data-testid="board-name-input"
        />
        <button type="button" className={styles.saveBtn} disabled={unchanged || saving} onClick={() => void save()} data-testid="board-name-save">
          {saving ? "Saving…" : "Rename"}
        </button>
      </div>
    </div>
  );
}
