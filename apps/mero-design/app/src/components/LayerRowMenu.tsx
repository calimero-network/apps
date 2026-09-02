import { useEffect, useRef, useState } from "react";
import styles from "./PropertiesPanel.module.css";

export interface RowAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

/**
 * The "⋯" menu on a layers-tree row.
 *
 * A group needs seven or eight actions (select, rename, ungroup, export, flatten,
 * delete) and the inspector is 260px wide, so they cannot all be buttons on the
 * row. It closes on outside click, on Escape, and after any action.
 */
export default function LayerRowMenu({ actions, testId }: { actions: RowAction[]; testId?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // This menu owns the Escape that closes it — the canvas must not also see
      // it and delete the element the menu belongs to.
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <div className={styles.rowMenu} ref={rootRef}>
      <button
        className={styles.rowMenuBtn}
        title="More"
        data-testid={testId}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >⋯</button>
      {open && (
        <div className={styles.rowMenuPopup} data-testid={testId ? `${testId}-popup` : undefined}>
          {actions.map((action) => (
            <button
              key={action.label}
              className={`${styles.rowMenuItem} ${action.danger ? styles.rowMenuItemDanger : ""}`}
              disabled={action.disabled}
              data-testid={action.testId}
              onClick={(e) => { e.stopPropagation(); setOpen(false); action.onSelect(); }}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
