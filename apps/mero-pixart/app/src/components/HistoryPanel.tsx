import { useEditorStore } from "../store/editorStore";
import { Icon } from "./ToolIcons";
import styles from "./HistoryPanel.module.css";

/**
 * Surfaces the undo/redo stack as a clickable timeline (Photoshop's History
 * panel). The store already keeps before-edit snapshots; this just visualises
 * them. Clicking a state jumps there via `jumpHistory`.
 *
 *   row 0            → "Open" (the initial document state, jumpHistory(0))
 *   rows 1..N        → each performed operation; current position highlighted
 *   greyed rows      → future (redoable) states
 */
export default function HistoryPanel() {
  const undoStack = useEditorStore((s) => s.undoStack);
  const redoStack = useEditorStore((s) => s.redoStack);
  const jumpHistory = useEditorStore((s) => s.jumpHistory);
  const clearHistory = useEditorStore((s) => s.clearHistory);
  const collapsed = useEditorStore((s) => s.panelCollapsed.history);
  const toggleCollapsed = useEditorStore((s) => s.togglePanelCollapsed);

  // Ordered operation labels across the whole timeline (past then future).
  const future = [...redoStack].reverse();
  const ops = [...undoStack.map((e) => e.label), ...future.map((e) => e.label)];
  const current = undoStack.length; // timeline index of the live state

  return (
    <div className={styles.panel} data-testid="history-panel">
      <div className={styles.header}>
        <button className="mp-collapse" onClick={() => toggleCollapsed("history")}
          aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} History`}>
          <span className="mp-chev">{collapsed ? "▸" : "▾"}</span>
          <span className="mp-label">History</span>
        </button>
        <button
          type="button"
          className="mp-btn mp-btn--ghost"
          title="Clear history"
          aria-label="Clear history"
          disabled={ops.length === 0}
          onClick={clearHistory}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      {!collapsed && (
        <div className={styles.list}>
          <Row label="Open" index={0} current={current} onJump={jumpHistory} icon="image" />
          {ops.map((label, i) => (
            <Row
              key={i}
              label={label}
              index={i + 1}
              current={current}
              onJump={jumpHistory}
              icon="undo"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({
  label, index, current, onJump, icon,
}: {
  label: string; index: number; current: number;
  onJump: (n: number) => void; icon: "image" | "undo";
}) {
  const isCurrent = index === current;
  const isFuture = index > current;
  return (
    <button
      type="button"
      className={`${styles.row} ${isCurrent ? styles.current : ""} ${isFuture ? styles.future : ""}`}
      onClick={() => onJump(index)}
      title={label}
    >
      <span className={styles.icon}><Icon name={icon} size={13} /></span>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
