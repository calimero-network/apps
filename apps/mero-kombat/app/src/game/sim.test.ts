import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIGHTERS, ROSTER } from "./fighters";
import { DAMAGE, Fighter, MOVES, NO_INPUT, MIN_X, MAX_X, PUSH, separate, type Input, type SimEvent } from "./sim";

const lib = readFileSync(path.resolve(__dirname, "../../../logic/src/lib.rs"), "utf8");

const press = (p: Partial<Input>): Input => ({ ...NO_INPUT, ...p });

function pair(gap = 34) {
  const a = new Fighter(FIGHTERS.kinetic, 200, 1);
  const b = new Fighter(FIGHTERS.cryo, 200 + gap, -1);
  return { a, b };
}

/** Step `f` with `first` on frame one and nothing after, `frames` times. */
function run(f: Fighter, foe: Fighter, first: Input, frames: number, hold?: Partial<Input>): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < frames; i += 1) {
    f.step(i === 0 ? first : press(hold ?? {}), foe, out);
  }
  return out;
}

const actions = (events: SimEvent[]) => events.filter((e) => e.t === "action");

describe("the contract and the client agree", () => {
  it("on what every move is worth", () => {
    for (const [kind, dmg] of Object.entries(DAMAGE)) {
      const re = new RegExp(`"${kind}"(?:\\s*\\|\\s*"\\w+")*\\s*=>\\s*(\\d+)`);
      const alt = new RegExp(`"\\w+"\\s*\\|\\s*"${kind}"\\s*=>\\s*(\\d+)`);
      const m = lib.match(re) ?? lib.match(alt);
      expect(m, `damage_of has ${kind}`).not.toBeNull();
      expect(Number(m![1]), kind).toBe(dmg);
    }
    expect(lib).toMatch(/const CHIP_DAMAGE: u32 = 1;/);
  });

  it("on the roster", () => {
    const m = lib.match(/pub const FIGHTERS: \[&str; \d+\] = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const ids = m![1].split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(ids).toEqual(ROSTER.map((f) => f.id));
  });
});

describe("a punch", () => {
  it("lands once on someone in reach, and becomes one hit action", () => {
    const { a, b } = pair();
    const events = run(a, b, press({ punch: true }), MOVES.punch.frames + 2);
    expect(actions(events)).toEqual([{ t: "action", kind: "punch", hit: true, blocked: false }]);
    expect(events.filter((e) => e.t === "hit")).toHaveLength(1);
    expect(a.state).toBe("idle");
  });

  it("whiffs at range and still becomes one action — a miss", () => {
    const { a, b } = pair(140);
    const events = run(a, b, press({ punch: true }), MOVES.punch.frames + 2);
    expect(actions(events)).toEqual([{ t: "action", kind: "punch", hit: false, blocked: false }]);
  });

  it("is blocked by a guard facing it, and not by one facing away", () => {
    const { a, b } = pair();
    b.state = "block";
    let events = run(a, b, press({ punch: true }), MOVES.punch.frames + 2);
    expect(actions(events)[0]).toMatchObject({ hit: true, blocked: true });

    const again = pair();
    again.b.state = "block";
    again.b.facing = 1; // back turned
    events = run(again.a, again.b, press({ punch: true }), MOVES.punch.frames + 2);
    expect(actions(events)[0]).toMatchObject({ hit: true, blocked: false });
  });
});

describe("crouching moves", () => {
  it("crouch + punch is an uppercut, which launches", () => {
    const { a, b } = pair();
    const events = run(a, b, press({ down: true, punch: true }), MOVES.uppercut.frames + 2);
    expect(actions(events)[0]).toMatchObject({ kind: "uppercut", hit: true });
    b.takeHit("uppercut", false, a.x);
    expect(b.state).toBe("launched");
    expect(b.vy).toBeGreaterThan(0);
  });

  it("crouch + kick is a sweep, which knocks down — and a fighter on the floor cannot be hit", () => {
    const { a, b } = pair(40);
    const events = run(a, b, press({ down: true, kick: true }), MOVES.sweep.frames + 2);
    expect(actions(events)[0]).toMatchObject({ kind: "sweep", hit: true });
    b.takeHit("sweep", false, a.x);
    expect(b.state).toBe("knockdown");
    expect(b.hurtbox()).toBeNull();
  });
});

describe("in the air", () => {
  it("a jump is an action of its own, and lands", () => {
    const { a, b } = pair(200);
    const events = run(a, b, press({ up: true }), 80);
    expect(actions(events)).toEqual([{ t: "action", kind: "jump", hit: false, blocked: false }]);
    expect(events.some((e) => e.t === "land")).toBe(true);
    expect(a.airborne).toBe(false);
  });

  it("allows one flying kick per jump", () => {
    const { a, b } = pair(300);
    const out: SimEvent[] = [];
    a.step(press({ up: true }), b, out);
    for (let i = 0; i < 6; i += 1) a.step(NO_INPUT, b, out);
    a.step(press({ kick: true }), b, out);
    expect(a.state).toBe("air_kick");
    a.step(press({ kick: true }), b, out);
    for (let i = 0; i < 80; i += 1) a.step(NO_INPUT, b, out);
    expect(actions(out).filter((e) => e.t === "action" && e.kind === "air_kick")).toHaveLength(1);
  });
});

describe("the special", () => {
  it("throws a projectile that hits across the arena, then cools down", () => {
    const { a, b } = pair(200);
    const events = run(a, b, press({ special: true }), 60);
    expect(actions(events)).toEqual([{ t: "action", kind: "special", hit: true, blocked: false }]);
    expect(a.projectile).toBeNull();
    expect(a.specialCd).toBeGreaterThan(0);
    a.step(press({ special: true }), b, []);
    expect(a.state).not.toBe("special");
  });

  it("is a miss when it leaves the screen", () => {
    const a = new Fighter(FIGHTERS.inferno, 100, 1);
    const b = new Fighter(FIGHTERS.cryo, 400, -1);
    b.state = "knockdown"; // nothing to hit
    const out: SimEvent[] = [];
    a.step(press({ special: true }), { x: b.x, hurtbox: () => null, guarding: () => false }, out);
    for (let i = 0; i < 200; i += 1) a.step(NO_INPUT, { x: b.x, hurtbox: () => null, guarding: () => false }, out);
    expect(actions(out)).toEqual([{ t: "action", kind: "special", hit: false, blocked: false }]);
  });
});

describe("bodies", () => {
  it("cannot walk through each other", () => {
    const { a, b } = pair(10);
    separate(a, b, true, true);
    expect(Math.abs(b.x - a.x)).toBeGreaterThanOrEqual(PUSH - 0.001);
  });

  it("stay inside the arena", () => {
    const a = new Fighter(FIGHTERS.kinetic, MIN_X + 2, 1);
    const b = new Fighter(FIGHTERS.cryo, 400, -1);
    for (let i = 0; i < 60; i += 1) a.step(press({ left: true }), b, []);
    expect(a.x).toBeGreaterThanOrEqual(MIN_X);
    const c = new Fighter(FIGHTERS.kinetic, MAX_X - 2, -1);
    for (let i = 0; i < 60; i += 1) c.step(press({ right: true }), a, []);
    expect(c.x).toBeLessThanOrEqual(MAX_X);
  });

  it("turn to face the opponent", () => {
    const a = new Fighter(FIGHTERS.kinetic, 300, 1);
    const b = new Fighter(FIGHTERS.cryo, 100, -1);
    a.step(NO_INPUT, b, []);
    expect(a.facing).toBe(-1);
  });

  it("a knocked-out fighter falls and stays down", () => {
    const { a, b } = pair();
    b.knockOut(a.x);
    for (let i = 0; i < 120; i += 1) b.idleStep();
    expect(b.state).toBe("ko");
    expect(b.airborne).toBe(false);
    expect(b.hurtbox()).toBeNull();
  });
});
