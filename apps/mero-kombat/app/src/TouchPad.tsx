import type { ReactNode } from "react";
import { LEGEND, type Button } from "./game/input";

/**
 * The key legend, which doubles as an on-screen pad: every keycap is pressable,
 * so the game is playable on a touch screen without a separate control scheme.
 */
export function TouchPad({ press }: { press: ((b: Button, down: boolean) => void) | null }) {
  const cap = (b: Button, label: ReactNode, keys: string, wide = false) => (
    <button
      type="button"
      key={b}
      className={`pad-key ${wide ? "wide" : ""} pad-${b}`}
      aria-label={typeof label === "string" ? label : b}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        press?.(b, true);
      }}
      onPointerUp={() => press?.(b, false)}
      onPointerCancel={() => press?.(b, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="pad-cap">{keys}</span>
      <span className="pad-label">{label}</span>
    </button>
  );

  const arrow = (d: string) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );

  const action = (b: Button) => LEGEND.find((l) => l.button === b);

  return (
    <div className="pad" aria-label="Controls">
      <div className="pad-dpad">
        {cap("up", arrow("M12 19V5M5 12l7-7 7 7"), "W")}
        <div className="pad-row">
          {cap("left", arrow("M19 12H5M12 19l-7-7 7-7"), "A")}
          {cap("down", arrow("M12 5v14M19 12l-7 7-7-7"), "S")}
          {cap("right", arrow("M5 12h14M12 5l7 7-7 7"), "D")}
        </div>
      </div>
      <div className="pad-actions">
        {(["punch", "kick", "block", "special"] as const).map((b) =>
          cap(b, action(b)?.label ?? b, action(b)?.keys[0] ?? "", false),
        )}
      </div>
      <p className="pad-hint">
        Crouch + Punch is an <strong>uppercut</strong>, crouch + Kick a <strong>sweep</strong>, Kick in the air a
        <strong> flying kick</strong>. Arrows + Z X C V work too.
      </p>
    </div>
  );
}
