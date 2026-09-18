import { useEffect, useRef, useState } from "react";

import styles from "../pages/Shell.module.css";

export interface CardMenuItem {
  label: string;
  onSelect: () => void;
  /** Renders in the danger colour. Use for anything that destroys data. */
  danger?: boolean;
  testId?: string;
}

/**
 * The "⋯" on a card, and the menu behind it.
 *
 * Matches mero-design and mero-pixart, so the same gesture works on the same
 * kind of screen across the three apps.
 *
 * ── Why destructive actions live in here ─────────────────────────────────────
 *
 * Deleting a space takes every forum in it. That is not something anyone should
 * be able to hit while reaching for Open, so it sits one deliberate gesture away
 * rather than on the card face next to the primary action.
 *
 * Closes on outside click and on Escape, and restores focus to the trigger when
 * dismissed — a menu that traps focus on a card grid is worse than no menu.
 */
export default function CardMenu({
  items,
  label = "More actions",
  testId,
}: {
  items: CardMenuItem[];
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        // Back to the trigger, not to the top of the document.
        btnRef.current?.focus();
      }
    };
    // `mousedown`, not `click`: a click listener added during this render fires
    // for the very click that opened the menu and closes it again immediately.
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={styles.menuBtn}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className={styles.dropdown} role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`${styles.dropdownItem} ${item.danger ? styles.dropdownDanger : ""}`}
              data-testid={item.testId}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
