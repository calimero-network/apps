import { useEffect, useRef, useState } from "react";
import styles from "./controls.module.css";

/**
 * A number input that can actually be typed into.
 *
 * The bug this replaces: every numeric property was
 *
 *   <input type="number" value={el.rotation} onChange={e => update(Number(e.target.value))} />
 *
 * a controlled input whose value is round-tripped through `Number()` on every
 * keystroke. Clearing the field makes `e.target.value` `""`, `Number("")` is 0,
 * and React immediately writes "0" back — so the field can never be empty, the
 * caret jumps to the end, and the only way to get from 0 to 20 is to place the
 * caret beside the existing zero and type around it. With rotation and corner
 * radius, both of which sit at 0 by default, that reads as "the field is broken".
 *
 * The fix is a draft: while the field is focused it holds exactly what was
 * typed, including "" and "-" and "1.", and only commits when the text parses.
 * On blur the draft is dropped and the field re-syncs to the real value.
 *
 * It also gets what a design tool's number field is expected to have: ↑/↓ (×10
 * with Shift, ÷10 with Alt), Enter to commit, Escape to revert, and a
 * drag-to-scrub grip on the label.
 */

interface Props {
  value: number;
  onChange: (value: number) => void;
  /** Short label shown inside the field; doubles as the scrub grip. */
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places kept when committing. 0 = integers. */
  precision?: number;
  suffix?: string;
  disabled?: boolean;
  title?: string;
  testId?: string;
  className?: string;
}

function clamp(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

function round(value: number, precision: number): number {
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

/** Accepts what people actually type; rejects partials so they can keep typing. */
export function parseNumeric(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "" || trimmed === "-" || trimmed === "." || trimmed === "-.") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function NumberField({
  value, onChange, label, min, max, step = 1, precision = 0,
  suffix, disabled = false, title, testId, className,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrubRef = useRef<{ startX: number; startValue: number } | null>(null);

  // An external change (canvas drag, undo, a peer's edit) must win — but never
  // while the user is mid-edit, or their keystrokes get overwritten.
  useEffect(() => {
    if (!focused) setDraft(null);
  }, [value, focused]);

  const shown = draft ?? String(round(value, precision));

  function commit(next: number) {
    const clamped = round(clamp(next, min, max), precision);
    if (clamped !== value) onChange(clamped);
    return clamped;
  }

  function handleChange(raw: string) {
    setDraft(raw);
    const parsed = parseNumeric(raw);
    // Commit as they type, but only when the text is a number. "" and "-" are
    // legitimate intermediate states and must not snap back to 0.
    if (parsed === null) return;
    const committed = commit(parsed);
    // Show the clamp when one happened ("500" in a field that maxes at 60), but
    // leave anything the field accepted exactly as typed — rewriting "1." to "1"
    // mid-decimal is the round-trip bug all over again.
    if (committed !== parsed) setDraft(String(committed));
  }

  function handleBlur() {
    setFocused(false);
    const parsed = parseNumeric(draft ?? "");
    if (parsed !== null) commit(parsed);
    setDraft(null); // re-sync to the committed value
  }

  function nudge(direction: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) {
    const magnitude = e.shiftKey ? step * 10 : e.altKey ? step / 10 : step;
    const base = parseNumeric(shown) ?? value;
    const next = commit(base + direction * magnitude);
    setDraft(String(next));
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      nudge(e.key === "ArrowUp" ? 1 : -1, e);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Escape") {
      // Revert to the committed value and get out of the field, so the canvas
      // shortcut layer sees the next Escape rather than this one.
      setDraft(null);
      inputRef.current?.blur();
      e.stopPropagation();
    }
  }

  /* Drag the label left/right to scrub the value. */
  function startScrub(e: React.PointerEvent<HTMLSpanElement>) {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    scrubRef.current = { startX: e.clientX, startValue: value };
  }
  function onScrub(e: React.PointerEvent<HTMLSpanElement>) {
    const scrub = scrubRef.current;
    if (!scrub) return;
    const perPixel = e.shiftKey ? step * 10 : e.altKey ? step / 10 : step;
    commit(scrub.startValue + Math.round((e.clientX - scrub.startX) / 2) * perPixel);
  }
  function endScrub(e: React.PointerEvent<HTMLSpanElement>) {
    if (!scrubRef.current) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    scrubRef.current = null;
  }

  return (
    <div
      className={[
        styles.number,
        focused ? styles.numberFocused : "",
        disabled ? styles.numberDisabled : "",
        className ?? "",
      ].filter(Boolean).join(" ")}
      title={title}
    >
      {label && (
        <span
          className={styles.numberGrip}
          onPointerDown={startScrub}
          onPointerMove={onScrub}
          onPointerUp={endScrub}
          onPointerCancel={endScrub}
          title={`${label} — drag to adjust`}
        >
          {label}
        </span>
      )}
      <input
        ref={inputRef}
        className={styles.numberInput}
        // Deliberately not type="number": its spinners cannot be styled, its
        // value is "" for anything unparsed (losing what was typed), and it
        // swallows the keys this field handles itself.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        data-testid={testId}
        value={shown}
        onFocus={(e) => { setFocused(true); e.target.select(); }}
        onBlur={handleBlur}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {suffix && <span className={styles.numberSuffix}>{suffix}</span>}
      <span className={styles.numberSteps}>
        <button
          type="button" tabIndex={-1} className={styles.numberStep} disabled={disabled}
          onClick={(e) => nudge(1, e)} title="Increase"
        >▲</button>
        <button
          type="button" tabIndex={-1} className={styles.numberStep} disabled={disabled}
          onClick={(e) => nudge(-1, e)} title="Decrease"
        >▼</button>
      </span>
    </div>
  );
}
