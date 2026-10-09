/**
 * Mero Kombat — attract mode. The real engine, two CPUs, looping: the same
 * renderer, stage and HUD a fight uses, so the landing page shows the game
 * rather than a picture of it.
 *
 * Positioned in literal pixels against the template's 495px stage, inside
 * `.cal-lp-a`, so the shared scale and play-state rules apply.
 */
import { useEffect, useRef } from "react";
import { Game } from "../../game/controller";
import { FIGHTERS } from "../../game/fighters";
import { H, W } from "../../game/sim";

const STEP_MS = 1000 / 60;

export default function KombatAnimation() {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const game = new Game("cpu", 0, [FIGHTERS.kinetic, FIGHTERS.inferno], null, null);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let overFor = 0;
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      while (acc >= STEP_MS) {
        game.step();
        acc -= STEP_MS;
        if (game.over && ++overFor > 240) {
          overFor = 0;
          game.restart();
        }
      }
      game.draw(ctx);
      if (!reduced) raf = requestAnimationFrame(frame);
    };
    // Reduced motion: one still frame, mid-fight.
    if (reduced) for (let i = 0; i < 400; i += 1) game.step();
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 22, top: 14 }}>
        Every blow is a transaction
      </span>
      <canvas
        ref={ref}
        width={W}
        height={H}
        style={{
          position: "absolute",
          left: 22,
          top: 40,
          width: 451,
          height: 254,
          borderRadius: 10,
          imageRendering: "pixelated",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.25)",
        }}
      />
    </div>
  );
}
