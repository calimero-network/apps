import styles from "./controls.module.css";

/**
 * Checkbox and switch, painted rather than left to the OS.
 *
 * Both keep a real `<input type="checkbox">` underneath — visually hidden, not
 * `display: none` — so they stay keyboard-reachable, announce themselves to a
 * screen reader, and keep the label-click behaviour for free.
 */

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
  testId?: string;
  title?: string;
}

export function Checkbox({ checked, onChange, label, disabled = false, testId, title }: CheckboxProps) {
  return (
    <label className={`${styles.checkbox} ${disabled ? styles.checkboxDisabled : ""}`} title={title}>
      <input
        type="checkbox"
        className={styles.checkboxNative}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        // Guarded rather than relying on `disabled` alone: a click synthesised
        // on the input still reaches this handler in jsdom, and a read-only
        // board must not mutate on one.
        onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
      />
      <span className={styles.checkboxBox}>
        <svg className={styles.checkboxTick} width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M1.5 5.2l2.2 2.3L8.5 2.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {label != null && <span>{label}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, label, disabled = false, testId, title }: CheckboxProps) {
  return (
    <label className={`${styles.switch} ${disabled ? styles.checkboxDisabled : ""}`} title={title}>
      <input
        type="checkbox"
        role="switch"
        className={styles.checkboxNative}
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => { if (!disabled) onChange(e.target.checked); }}
      />
      <span className={styles.switchTrack}><span className={styles.switchThumb} /></span>
      {label != null && <span>{label}</span>}
    </label>
  );
}

/* ── Segmented control ─────────────────────────────────────────────── */

export interface Segment<T extends string> {
  value: T;
  /** Icon or short text on the segment. */
  content: React.ReactNode;
  title?: string;
  testId?: string;
  style?: React.CSSProperties;
}

interface SegmentedProps<T extends string> {
  /** `null` when nothing is active — e.g. bold and italic both off. */
  value: T | null;
  segments: Segment<T>[];
  /** Fires on every click, including on the active segment, so a caller can
   *  treat a segment as a toggle (bold) or as a radio (alignment). */
  onChange: (value: T) => void;
  disabled?: boolean;
  testId?: string;
  ariaLabel?: string;
}

/**
 * The radio-group control: text alignment, bold/italic, background choice. Rendered
 * as buttons in a `radiogroup` rather than as `<input type="radio">`, because a
 * native radio cannot be an icon and its OS dot is not stylable.
 */
export function Segmented<T extends string>({
  value, segments, onChange, disabled = false, testId, ariaLabel,
}: SegmentedProps<T>) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={ariaLabel} data-testid={testId}>
      {segments.map((segment) => {
        const active = segment.value === value;
        return (
          <button
            type="button"
            key={segment.value}
            role="radio"
            aria-checked={active}
            title={segment.title}
            data-testid={segment.testId}
            disabled={disabled}
            style={segment.style}
            className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
            onClick={() => onChange(segment.value)}
          >
            {segment.content}
          </button>
        );
      })}
    </div>
  );
}
