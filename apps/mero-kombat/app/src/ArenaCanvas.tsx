import { useEffect, useRef, useState } from "react";
import { Game, type ArenaState, type Mode, type NetHooks, type Slice } from "./game/controller";
import { fighterOf, type FighterId } from "./game/fighters";
import { Controls, type Button } from "./game/input";
import { H, W } from "./game/sim";

const STEP_MS = 1000 / 60;

export interface ArenaCanvasProps {
  mode: Mode;
  /** The slot this screen plays; null to spectate. */
  local: 0 | 1 | null;
  /** Fighter looks, p1 then p2. In `net` mode the contract's view overrides. */
  fighters: [FighterId, FighterId];
  /** The latest contract read. `net`/`spectate`. */
  state?: ArenaState | null;
  hooks?: NetHooks | null;
  /** Subscribe to presence slices. */
  subscribe?: ((handler: (s: Slice) => void) => () => void) | null;
  /** Hand the pad's controls to the caller, for the on-screen buttons. */
  onControls?: (press: (b: Button, down: boolean) => void) => void;
  /** Practice: the match ended. */
  onOver?: (over: boolean) => void;
  /** Practice: bump to start a fresh match. */
  restartKey?: number;
  label: string;
}

/**
 * The cabinet screen: a 480×270 canvas scaled up with crisp pixels, a fixed
 * 60 Hz simulation, and the game behind it.
 *
 * The `Game` is rebuilt only when what it fundamentally IS changes — the mode
 * or the seat. Everything else is fed into the running instance, so a contract
 * read arriving mid-punch does not restart the punch.
 */
export function ArenaCanvas({ mode, local, fighters, state, hooks, subscribe, onControls, onOver, restartKey, label }: ArenaCanvasProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const game = useRef<Game | null>(null);
  const controls = useRef(new Controls());
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;
  const [over, setOver] = useState(false);

  const fighterKey = mode === "cpu" ? fighters.join(",") : "";

  // Build the game for this mode and seat.
  useEffect(() => {
    const net: NetHooks | null =
      mode === "net"
        ? {
            publish: (s) => hooksRef.current?.publish(s),
            act: (a) => hooksRef.current?.act(a) ?? Promise.reject(new Error("offline")),
          }
        : null;
    game.current = new Game(mode, local, [fighterOf(fighters[0]), fighterOf(fighters[1])], controls.current, net);
    setOver(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, local, fighterKey]);

  // Feed contract reads in.
  useEffect(() => {
    if (state && game.current) game.current.setState(state);
  }, [state, mode, local, fighterKey]);

  // Presence in.
  useEffect(() => {
    if (!subscribe) return;
    return subscribe((slice) => game.current?.onSlice(slice));
  }, [subscribe, mode, local]);

  // Keyboard.
  useEffect(() => controls.current.attach(), []);
  useEffect(() => {
    onControls?.((b, down) => controls.current.press(b, down));
  }, [onControls]);

  // Practice rematch on Enter.
  useEffect(() => {
    if (mode !== "cpu") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && game.current?.over) game.current.restart();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  useEffect(() => {
    if (restartKey) game.current?.restart();
  }, [restartKey]);

  // The loop.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let wasOver = false;
    let frames = 0;
    const frame = (now: number) => {
      acc += Math.min(250, now - last);
      last = now;
      const g = game.current;
      if (g) {
        let steps = 0;
        while (acc >= STEP_MS && steps < 5) {
          g.step();
          acc -= STEP_MS;
          steps += 1;
        }
        if (steps === 5) acc = 0;
        g.draw(ctx);
        // Where the two fighters stand, for anything driving the page from the
        // outside — the recorded duel's bots read it. A few times a second.
        if (++frames % 10 === 0) {
          el.dataset["p1x"] = g.fighters[0].x.toFixed(0);
          el.dataset["p2x"] = g.fighters[1].x.toFixed(0);
        }
        if (g.over !== wasOver) {
          wasOver = g.over;
          setOver(g.over);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    onOver?.(over);
  }, [over, onOver]);

  return (
    <canvas
      ref={canvas}
      className="arena-canvas"
      width={W}
      height={H}
      role="img"
      aria-label={label}
      tabIndex={0}
      onPointerDown={(e) => e.currentTarget.focus()}
    />
  );
}
