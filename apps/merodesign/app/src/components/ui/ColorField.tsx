import { useEffect, useState } from "react";
import styles from "./controls.module.css";

/**
 * Swatch + hex, in one control.
 *
 * The panel used to show a bare `<input type="color">` (a chunky OS-drawn button
 * whose size and border cannot be set) with the hex in a `<span>` beside it,
 * read-only. Here the native input is still the thing that opens the OS picker —
 * it is just stretched invisibly over a swatch we draw, on a chequerboard so
 * "no fill" reads as transparent rather than as white. The hex is editable,
 * because typing `#4F8EF7` is how a colour usually arrives.
 */

interface Props {
  /** Any CSS colour, or "transparent"/"none"/"" for unset. */
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  title?: string;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Expands #abc to #aabbcc; returns null for anything that is not a hex colour. */
export function normalizeHex(raw: string): string | null {
  const match = raw.trim().match(HEX);
  if (!match) return null;
  const body = match[1];
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${full.toLowerCase()}`;
}

function isPainted(value: string): boolean {
  return !!value && value !== "transparent" && value !== "none";
}

export default function ColorField({ value, onChange, disabled = false, testId, title }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => { setDraft(null); }, [value]);

  const painted = isPainted(value);
  // <input type="color"> only accepts #rrggbb, so give it a stand-in for named
  // and rgba() values rather than letting it silently reset to black.
  const picker = normalizeHex(value) ?? "#4f8ef7";
  const shown = draft ?? (painted ? value : "");

  function commitHex(raw: string) {
    const hex = normalizeHex(raw);
    if (hex) onChange(hex);
    setDraft(null);
  }

  return (
    <div className={styles.color} title={title}>
      <span className={styles.colorSwatchWrap}>
        {painted && <span className={styles.colorSwatchFill} style={{ background: value }} />}
        <input
          type="color"
          className={styles.colorNative}
          value={picker}
          disabled={disabled}
          data-testid={testId}
          onChange={(e) => onChange(e.target.value)}
          aria-label={title ?? "Colour"}
        />
      </span>
      <input
        className={styles.colorHex}
        value={shown}
        disabled={disabled}
        placeholder={painted ? "" : "none"}
        spellCheck={false}
        data-testid={testId ? `${testId}-hex` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commitHex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          // Escape reverts this field; it must not reach the canvas and delete
          // the element being recoloured.
          if (e.key === "Escape") { e.stopPropagation(); setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </div>
  );
}
