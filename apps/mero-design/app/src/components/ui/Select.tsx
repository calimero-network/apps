import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./controls.module.css";

/**
 * A styled dropdown over a listbox, replacing `<select>` in the inspector.
 *
 * A native select cannot be styled beyond its box — the popup is drawn by the
 * OS, so the font menu came up in the system's own chrome at the system's own
 * size, and each option's preview font could not be shown. This renders the
 * options itself, keeps the keyboard contract (Enter/Space to open, arrows to
 * move, Home/End, Escape to close, type-ahead), and flips the menu upward when
 * it would run off the bottom of the panel.
 */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** Rendered on the option row, e.g. the font it names. */
  style?: React.CSSProperties;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  testId?: string;
  ariaLabel?: string;
}

export default function Select<T extends string>({
  value, options, onChange, disabled = false, placeholder = "Select…", testId, ariaLabel,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const typeAhead = useRef({ text: "", at: 0 });

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    // Capture: a canvas listener could otherwise swallow the click first.
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) setDropUp(window.innerHeight - rect.bottom < 240 && rect.top > 240);
  }, [open, options, value]);

  useEffect(() => {
    if (!open) return;
    // Optional-called: jsdom has no scrollIntoView, and neither does every
    // element type this could land on.
    menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function choose(next: T) {
    onChange(next);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    // Open: this component owns Escape, so it must not also reach the canvas
    // and delete the selected element.
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIndex((i) => Math.min(options.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Home") { e.preventDefault(); setActiveIndex(0); return; }
    if (e.key === "End") { e.preventDefault(); setActiveIndex(options.length - 1); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = options[activeIndex];
      if (option) choose(option.value);
      return;
    }
    if (e.key.length === 1) {
      const now = Date.now();
      typeAhead.current.text = now - typeAhead.current.at > 800 ? e.key : typeAhead.current.text + e.key;
      typeAhead.current.at = now;
      const query = typeAhead.current.text.toLowerCase();
      const found = options.findIndex((o) => o.label.toLowerCase().startsWith(query));
      if (found >= 0) setActiveIndex(found);
    }
  }

  return (
    <div className={`${styles.select} ${open ? styles.selectOpen : ""}`} ref={rootRef}>
      <button
        type="button"
        className={styles.selectTrigger}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        data-testid={testId}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.selectValue} style={selected?.style}>
          {selected?.label ?? placeholder}
        </span>
        <svg className={styles.selectChevron} width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`${styles.selectMenu} ${dropUp ? styles.selectMenuUp : ""}`}
          role="listbox"
          ref={menuRef}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              data-index={index}
              role="option"
              aria-selected={option.value === value}
              className={[
                styles.selectOption,
                index === activeIndex ? styles.selectOptionActive : "",
                option.value === value ? styles.selectOptionSelected : "",
              ].filter(Boolean).join(" ")}
              style={option.style}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.value)}
            >
              <span className={styles.selectValue}>{option.label}</span>
              {option.value === value && <span className={styles.selectCheck}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
