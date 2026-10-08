import { describe, expect, it, vi } from "vitest";
import { Game, type ArenaState, type NetHooks, type Slice } from "./controller";
import { FIGHTERS } from "./fighters";
import type { Controls } from "./input";
import { NO_INPUT, type Input } from "./sim";

/** Controls that replay a queue, one entry per frame, once it is armed. */
function scripted(frames: Partial<Input>[] = []): Controls & { arm(): void } {
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    read: () => ({ ...NO_INPUT, ...((armed && frames.shift()) || {}) }),
  } as unknown as Controls & { arm(): void };
}

function state(over: Partial<ArenaState> = {}): ArenaState {
  return {
    status: "fighting",
    match: 0,
    round: 0,
    results: [],
    winner: "",
    flawless: false,
    names: ["Alice", "Bob"],
    fighters: ["kinetic", "cryo"],
    online: [true, true],
    hp: [100, 100],
    rounds: [0, 0],
    hits: [],
    ...over,
  };
}

function slice(over: Partial<Slice> = {}): Slice {
  return { v: 1, seat: "p2", m: 0, r: 0, x: 330, y: 0, vx: 0, vy: 0, f: -1, s: "idle", k: 0, fi: "cryo", p: null, h: [], n: 1, ...over };
}

function hooks() {
  const acts: Parameters<NetHooks["act"]>[0][] = [];
  const slices: Slice[] = [];
  const h: NetHooks = {
    publish: (s) => slices.push(s),
    act: (a) => {
      acts.push(a);
      return Promise.resolve(12);
    },
  };
  return { h, acts, slices };
}

const steps = (g: Game, n: number) => {
  for (let i = 0; i < n; i += 1) g.step();
};

/** A net game for p1, past the intro, with p2 standing `gap` away. */
function fighting(gap = 34, script: Partial<Input>[] = []) {
  const { h, acts, slices } = hooks();
  const controls = scripted(script);
  const g = new Game("net", 0, [FIGHTERS.kinetic, FIGHTERS.cryo], controls, h);
  g.setState(state());
  g.onSlice(slice());
  steps(g, 2);
  expect(g.currentPhase).toBe("intro");
  steps(g, 100);
  expect(g.currentPhase).toBe("fight");
  g.fighters[0].x = 200;
  g.fighters[1].x = 200 + gap;
  g.onSlice(slice({ x: 200 + gap, n: 2 }));
  controls.arm();
  return { g, acts, slices };
}

describe("a networked fight", () => {
  it("waits for the opponent's stream before ringing the bell", () => {
    const { h } = hooks();
    const g = new Game("net", 0, [FIGHTERS.kinetic, FIGHTERS.cryo], scripted(), h);
    g.setState(state());
    steps(g, 30);
    expect(g.currentPhase).toBe("waiting");
    g.onSlice(slice());
    steps(g, 1);
    expect(g.currentPhase).toBe("intro");
  });

  it("streams this fighter fifteen times a second", () => {
    const { g, slices } = fighting();
    const before = slices.length;
    steps(g, 60);
    expect(slices.length - before).toBe(15);
    expect(slices.at(-1)).toMatchObject({ v: 1, seat: "p1", m: 0, r: 0 });
  });

  it("turns a landed punch into one transaction and moves the bar at once", async () => {
    const { g, acts, slices } = fighting(34, [{ punch: true }]);
    steps(g, 30);
    expect(acts).toHaveLength(1);
    expect(acts[0]).toMatchObject({ match: 0, round: 0, kind: "punch", hit: true, blocked: false });
    // Before the contract has counted it, the bar already shows it…
    expect(g.shownHp(1)).toBe(95);
    // …and the blow travels in the slice so the other screen reacts.
    expect(slices.at(-1)!.h.map((x) => x[0])).toContain(acts[0].id);

    // The contract counts it: the bar holds, it is not subtracted twice.
    g.setState(state({ hp: [100, 95], hits: [`p1:${acts[0].id}`] }));
    steps(g, 2);
    expect(g.shownHp(1)).toBe(95);
  });

  it("sends a miss as a transaction too", () => {
    const { g, acts } = fighting(160, [{ punch: true }]);
    steps(g, 30);
    expect(acts).toEqual([expect.objectContaining({ kind: "punch", hit: false })]);
    expect(g.shownHp(1)).toBe(100);
  });

  it("feels the opponent's blow from their stream, once", () => {
    const { g } = fighting();
    g.onSlice(slice({ x: 234, h: [[7001, 1, 0]], n: 3 }));
    steps(g, 1);
    expect(g.fighters[0].state === "hit" || g.fighters[0].flash > 0).toBe(true);
    expect(g.shownHp(0)).toBe(93); // a kick
    g.onSlice(slice({ x: 234, h: [[7001, 1, 0]], n: 4 }));
    steps(g, 1);
    expect(g.shownHp(0)).toBe(93);
  });

  it("ignores blows from a round this screen is not fighting", () => {
    const { g } = fighting();
    g.onSlice(slice({ r: 3, h: [[1, 0, 0]], n: 3 }));
    steps(g, 2);
    expect(g.shownHp(0)).toBe(100);
  });

  it("plays the knock-out the contract decided, then the next round", () => {
    const { g } = fighting();
    g.setState(state({ round: 1, results: ["p1"], rounds: [1, 0], hp: [100, 100] }));
    steps(g, 1);
    expect(g.currentPhase).toBe("ko");
    expect(g.fighters[1].state).toBe("ko");
    steps(g, 170);
    expect(g.currentPhase).toBe("intro");
    expect(g.roundsWon).toEqual([1, 0]);
  });

  it("falls the moment the bars run out, before the node confirms", () => {
    const { g } = fighting();
    g.setState(state({ hp: [100, 4] }));
    g.onSlice(slice({ n: 5 }));
    steps(g, 1);
    expect(g.currentPhase).toBe("fight");
    // A blow of ours, seen by our own screen first.
    const { g: g2 } = fighting(34, [{ punch: true }]);
    g2.setState(state({ hp: [100, 4] }));
    steps(g2, 30);
    expect(g2.currentPhase).toBe("ko");
  });

  it("shows the finished match", () => {
    const { h } = hooks();
    const g = new Game("net", 1, [FIGHTERS.kinetic, FIGHTERS.cryo], scripted(), h);
    g.setState(state({ status: "finished", winner: "p2", results: ["p2", "p2"], rounds: [0, 2] }));
    steps(g, 2);
    expect(g.over).toBe(true);
    expect(g.fighters[1].state).toBe("victory");
  });

  it("sends nothing as a spectator", () => {
    const act = vi.fn();
    const publish = vi.fn();
    const g = new Game("spectate", null, [FIGHTERS.kinetic, FIGHTERS.cryo], null, { act, publish });
    g.setState(state());
    g.onSlice(slice({ seat: "p1", x: 150, f: 1 }));
    g.onSlice(slice({ seat: "p2" }));
    steps(g, 300);
    expect(act).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("practice", () => {
  it("with nobody at the controls, two CPUs fight it out (attract mode)", () => {
    const g = new Game("cpu", 0, [FIGHTERS.kinetic, FIGHTERS.inferno], null, null);
    let frames = 0;
    while (!g.over && frames < 60 * 60 * 10) {
      g.step();
      frames += 1;
    }
    expect(g.over).toBe(true);
    expect(Math.max(...g.roundsWon)).toBe(2);
  });

  it("the CPU beats a fighter who never moves, best of three", () => {
    const g = new Game("cpu", 0, [FIGHTERS.kinetic, FIGHTERS.inferno], scripted(), null);
    let frames = 0;
    while (!g.over && frames < 60 * 60 * 10) {
      g.step();
      frames += 1;
    }
    expect(g.over).toBe(true);
    expect(g.roundsWon).toEqual([0, 2]);
  });
});
