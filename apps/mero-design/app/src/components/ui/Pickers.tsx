import type { StrokeStyle } from "../../types";
import { dashArray, strokeCap, STROKE_STYLES } from "../../utils/shapes";
import styles from "./controls.module.css";

/**
 * The inspector's quick pickers: a row of colour chips, and the stroke-style
 * row that shows each dash pattern as the line it draws rather than as a word.
 */

interface SwatchRowProps {
  colors: { value: string; label?: string }[];
  value: string | null | undefined;
  onChange: (color: string) => void;
  disabled?: boolean;
  /** Each chip gets `${testId}-${index}`. */
  testId?: string;
  ariaLabel: string;
  /** Bigger, rounder chips — the sticky-note colours. */
  large?: boolean;
}

export function SwatchRow({ colors, value, onChange, disabled, testId, ariaLabel, large }: SwatchRowProps) {
  const current = (value ?? "").toLowerCase();
  return (
    <div className={styles.swatchRow} role="radiogroup" aria-label={ariaLabel} data-testid={testId}>
      {colors.map((c, i) => {
        const active = c.value.toLowerCase() === current;
        return (
          <button
            type="button"
            key={c.value}
            role="radio"
            aria-checked={active}
            aria-label={c.label ?? c.value}
            title={c.label ?? c.value}
            disabled={disabled}
            data-testid={testId ? `${testId}-${i}` : undefined}
            className={`${styles.swatch} ${large ? styles.swatchLarge : ""} ${active ? styles.swatchActive : ""}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
          />
        );
      })}
    </div>
  );
}

interface StrokeStylePickerProps {
  value: StrokeStyle | undefined;
  onChange: (style: StrokeStyle) => void;
  disabled?: boolean;
}

/** A preview line per style, drawn with the same dash math as the canvas. */
function StylePreview({ style }: { style: StrokeStyle }) {
  const pattern = dashArray(style, 2);
  return (
    <svg width="26" height="8" viewBox="0 0 26 8" aria-hidden="true">
      <line
        x1="2" y1="4" x2="24" y2="4"
        stroke="currentColor" strokeWidth="2"
        strokeDasharray={pattern?.join(" ")}
        strokeLinecap={strokeCap(style) === "round" ? "round" : "butt"}
      />
    </svg>
  );
}

export function StrokeStylePicker({ value, onChange, disabled }: StrokeStylePickerProps) {
  const current = value ?? "solid";
  return (
    <div className={styles.styleGrid} role="radiogroup" aria-label="Stroke style" data-testid="stroke-style">
      {STROKE_STYLES.map((s) => {
        const active = s.value === current;
        return (
          <button
            type="button"
            key={s.value}
            role="radio"
            aria-checked={active}
            aria-label={s.label}
            title={s.label}
            disabled={disabled}
            data-testid={`stroke-style-${s.value}`}
            className={`${styles.styleOption} ${active ? styles.styleOptionActive : ""}`}
            onClick={() => onChange(s.value)}
          >
            <StylePreview style={s.value} />
          </button>
        );
      })}
    </div>
  );
}
