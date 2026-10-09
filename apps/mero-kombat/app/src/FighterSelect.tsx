import { useEffect, useRef } from "react";
import { ROSTER, fighterOf, type FighterId } from "./game/fighters";
import { poseFor } from "./game/pose";
import { drawFighter } from "./game/render";

/**
 * A fighter, drawn by the same renderer the arena uses, standing in its
 * stance against a dark plate. Painted once — portraits do not need a loop.
 */
export function Portrait({ id, size = 96, facing = 1, className }: { id: string; size?: number; facing?: 1 | -1; className?: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const s = 80;
    ctx.clearRect(0, 0, s, s);
    const bg = ctx.createRadialGradient(s / 2, s * 0.45, 4, s / 2, s / 2, s * 0.7);
    bg.addColorStop(0, "#3a1a26");
    bg.addColorStop(1, "#0d0a10");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, s, s);
    const def = fighterOf(id);
    const pose = poseFor({ state: "idle", frame: 0, walk: 0, vy: 0, airborne: false, time: 0 });
    // Close-up: chest and head fill the frame, like the select screen did.
    drawFighter(ctx, def, pose, { x: s / 2 - 4 * facing, y: 0, facing, grounded: true, flash: false, time: 0, shadow: false, floor: s + 54, scale: 1.25 });
    const shine = ctx.createLinearGradient(0, 0, 0, s);
    shine.addColorStop(0, "rgba(255,255,255,0.06)");
    shine.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = shine;
    ctx.fillRect(0, 0, s, s);
  }, [id, facing]);
  return (
    <canvas
      ref={ref}
      width={80}
      height={80}
      className={`portrait ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export function FighterSelect({
  value,
  onChange,
  disabled,
}: {
  value: FighterId;
  onChange: (id: FighterId) => void;
  disabled?: boolean;
}) {
  const current = fighterOf(value);
  return (
    <div className="select">
      <div className="select-grid" role="radiogroup" aria-label="Choose your fighter">
        {ROSTER.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === value}
            aria-label={f.name}
            className={`select-tile ${f.id === value ? "on" : ""}`}
            style={{ ["--tile" as string]: f.main }}
            disabled={disabled}
            onClick={() => onChange(f.id)}
          >
            <Portrait id={f.id} size={64} />
            <span className="select-name">{f.name}</span>
          </button>
        ))}
      </div>
      <p className="select-blurb">
        <strong>{current.name}</strong> — {current.title}. Special: <em>{current.special.name}</em>.
      </p>
    </div>
  );
}
