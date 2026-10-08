/**
 * The fight: two bodies, the phase of the round, and where the truth comes
 * from.
 *
 * Three modes share everything but that last part:
 *
 *  * `cpu`      — practice. Both bodies simulated here, health kept here.
 *  * `net`      — a real fight. YOUR body is simulated here and streamed to
 *                 the other node over ephemeral presence; THEIR body is a
 *                 puppet of their stream. Every action you finish becomes one
 *                 contract transaction, and the health bars settle on what the
 *                 contract derives from those transactions.
 *  * `spectate` — both bodies are puppets.
 *
 * In `net` mode a blow moves the bars the instant it lands (from the slice that
 * announces it) and the contract's figure replaces that guess as soon as the
 * transaction reaches this node — the pair are keyed by the thrower's sequence
 * number, so a blow is never subtracted twice.
 */
import { announce, sfx } from "./audio";
import { Cpu } from "./ai";
import { fighterOf, type FighterDef } from "./fighters";
import { Fx } from "./fx";
import { drawBanner, drawCaption, drawHud, type HudSide } from "./hud";
import type { Controls } from "./input";
import { poseFor } from "./pose";
import { drawFighter, drawProjectile } from "./render";
import {
  CHIP,
  DAMAGE,
  Fighter,
  MOVE_KINDS,
  NO_INPUT,
  separate,
  type MoveKind,
  type SimEvent,
  type Target,
} from "./sim";
import { drawStage } from "./stage";

export type Mode = "cpu" | "net" | "spectate";
export type Seat = "p1" | "p2";
export type Phase = "waiting" | "intro" | "fight" | "ko" | "over";

const START_X: [number, number] = [150, 330];
const SEATS: [Seat, Seat] = ["p1", "p2"];
/** Publish a slice every N frames: 15 a second. */
const SLICE_EVERY = 4;
/** An opponent whose slices stopped this long ago is not here. */
const STALE_MS = 4_000;
/** How long an unconfirmed blow keeps counting against the bars. */
const PENDING_MS = 8_000;
const MAX_HP = 100;

/** What travels over ephemeral presence, 15 times a second. Kept terse. */
export interface Slice {
  v: 1;
  seat: Seat;
  /** Match and round this body is fighting. */
  m: number;
  r: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  f: 1 | -1;
  s: string;
  k: number;
  fi: string;
  /** Projectile: x, height, vx. */
  p: [number, number, number] | null;
  /** Recent blows that landed: [sequence id, move index, blocked]. */
  h: [number, number, 0 | 1][];
  n: number;
}

/** What the controller needs from the outside world in `net` mode. */
export interface NetHooks {
  publish(slice: Slice): void;
  /** One contract transaction. Resolves with its round-trip in ms. */
  act(a: { match: number; round: number; id: number; kind: MoveKind; hit: boolean; blocked: boolean }): Promise<number>;
}

/** The subset of the contract's ArenaView the fight reads. */
export interface ArenaState {
  status: string;
  match: number;
  round: number;
  results: string[];
  winner: string;
  flawless: boolean;
  names: [string, string];
  fighters: [string, string];
  online: [boolean, boolean];
  hp: [number, number];
  rounds: [number, number];
  /** `"<seat>:<id>"` for every blow the contract has counted this round. */
  hits: string[];
}

interface Pending {
  target: 0 | 1;
  damage: number;
  at: number;
}

interface RemoteFeed {
  slice: Slice;
  /** performance.now() when it arrived, and the tick it arrived on. */
  at: number;
  tick: number;
  /** Ticks to leave the puppet's own predicted reaction alone. */
  hold: number;
}

export class Game {
  readonly fighters: [Fighter, Fighter];
  readonly fx = new Fx();
  private phase: Phase = "waiting";
  private phaseFrame = 0;
  private tick = 0;
  private hitstop = 0;

  private hp: [number, number] = [MAX_HP, MAX_HP];
  private trail: [number, number] = [1, 1];
  private rounds: [number, number] = [0, 0];
  private match = 0;
  private round = 0;
  private names: [string, string] = ["", ""];
  private online: [boolean, boolean] = [true, true];
  private koLoser: 0 | 1 | null = null;
  private koDouble = false;
  private koConfirmed = false;
  private winner: string = "";
  private flawless = false;

  // net
  private contractHp: [number, number] = [MAX_HP, MAX_HP];
  private counted = new Set<string>();
  private pending = new Map<string, Pending>();
  private seen = new Set<string>();
  private feeds: [RemoteFeed | null, RemoteFeed | null] = [null, null];
  private seq = Math.floor(Date.now() / 1000) % 1_000_000 * 1000;
  private myHits: [number, number, 0 | 1][] = [];
  private sliceN = 0;
  private state: ArenaState | null = null;
  /** A round the contract decided, applied once the knock-out has played. */
  private pendingRound: { round: number; rounds: [number, number]; finished: boolean } | null = null;

  // cpu — and a second one for attract mode, when nobody holds the controls
  private cpu = new Cpu();
  private cpu2 = new Cpu();

  constructor(
    readonly mode: Mode,
    /** The slot this screen plays, or null for a spectator. */
    readonly local: 0 | 1 | null,
    defs: [FighterDef, FighterDef],
    private controls: Controls | null,
    private net: NetHooks | null,
  ) {
    this.fighters = [new Fighter(defs[0], START_X[0], 1), new Fighter(defs[1], START_X[1], -1)];
    if (mode === "cpu") {
      this.names = [defs[0].name, defs[1].name];
      this.startIntro();
    }
  }

  // ── inputs from outside ────────────────────────────────────────────────

  /** A fresh contract read. `net` and `spectate` only. */
  setState(s: ArenaState) {
    const first = this.state === null;
    const prev = this.state;
    this.state = s;
    this.names = s.names;
    this.online = s.online;
    this.contractHp = s.hp;
    this.counted = new Set(s.hits);
    for (const slot of [0, 1] as const) {
      const def = fighterOf(s.fighters[slot]);
      if (this.fighters[slot].def.id !== def.id) this.fighters[slot].def = def;
    }

    if (s.status === "waiting") {
      this.rounds = s.rounds;
      this.match = s.match;
      this.round = s.round;
      this.enter("waiting");
      return;
    }

    const newMatch = !first && prev !== null && s.match !== prev.match;
    const newRound = !first && prev !== null && s.match === prev.match && s.results.length > prev.results.length;

    if (first || newMatch || (prev && prev.status === "waiting")) {
      this.match = s.match;
      this.round = s.round;
      this.rounds = s.rounds;
      this.winner = s.winner;
      this.flawless = s.flawless;
      this.resetRoundBookkeeping();
      if (s.status === "finished") {
        this.showOver();
      } else {
        this.enter("waiting"); // becomes intro once the opponent's stream is live
      }
      return;
    }

    if (newRound) {
      const result = s.results[s.results.length - 1];
      this.winner = s.winner;
      this.flawless = s.flawless;
      if (this.phase === "ko") {
        this.koConfirmed = true;
      } else {
        // The node knew before this screen did: fall now.
        const loser = result === "p1" ? 1 : result === "p2" ? 0 : null;
        this.startKo(loser, result === "draw");
        this.koConfirmed = true;
      }
      this.pendingRound = { round: s.round, rounds: s.rounds, finished: s.status === "finished" };
      return;
    }

    this.rounds = s.rounds;
  }

  /** An opponent's (or, spectating, either fighter's) presence slice. */
  onSlice(slice: Slice) {
    if (!slice || slice.v !== 1) return;
    if (slice.seat !== "p1" && slice.seat !== "p2") return;
    const slot: 0 | 1 = slice.seat === "p1" ? 0 : 1;
    if (slot === this.local) return;
    const prev = this.feeds[slot];
    if (prev && slice.n <= prev.slice.n && slice.n > 3) return; // out of order
    this.feeds[slot] = { slice, at: performance.now(), tick: this.tick, hold: prev?.hold ?? 0 };
  }

  // ── the loop ───────────────────────────────────────────────────────────

  step() {
    this.tick += 1;
    this.phaseFrame += 1;

    if (this.mode !== "cpu") this.readFeeds();

    if (this.hitstop > 0) {
      this.hitstop -= 1;
    } else {
      this.stepBodies();
    }

    this.stepPhase();
    this.settleBars();

    if (this.mode === "net" && this.local !== null && this.tick % SLICE_EVERY === 0) this.publish();
  }

  private stepBodies() {
    const events: [SimEvent[], SimEvent[]] = [[], []];
    const fighting = this.phase === "fight";
    for (const slot of [0, 1] as const) {
      const me = this.fighters[slot];
      const foe = this.fighters[1 - slot];
      const simulated = this.mode === "cpu" || slot === this.local;
      if (!simulated) {
        this.stepPuppet(slot);
        continue;
      }
      if (fighting && !me.down) {
        const input =
          this.mode === "cpu" && slot === 1
            ? this.cpu.think(me, foe)
            : this.mode === "cpu" && !this.controls
              ? this.cpu2.think(me, foe)
              : (this.controls?.read() ?? NO_INPUT);
        me.step(input, this.targetFor(foe), events[slot]);
      } else if (me.state === "ko" || me.state === "victory" || me.state === "launched") {
        me.idleStep();
      } else {
        me.step(NO_INPUT, this.targetFor(foe), events[slot]);
        this.controls?.read();
      }
    }

    const [a, b] = this.fighters;
    const moveA = this.mode === "cpu" || this.local === 0;
    const moveB = this.mode === "cpu" || this.local === 1;
    separate(a, b, moveA, moveB);
    if (this.phase !== "ko" && this.phase !== "over") {
      if (!a.down && a.state !== "victory") a.faceToward(b.x);
      if (!b.down && b.state !== "victory") b.faceToward(a.x);
    }

    for (const slot of [0, 1] as const) {
      for (const e of events[slot]) this.handle(slot, e);
    }
  }

  private targetFor(f: Fighter): Target {
    return { x: f.x, hurtbox: () => f.hurtbox(), guarding: (fromX) => f.guarding(fromX) };
  }

  private handle(slot: 0 | 1, e: SimEvent) {
    const me = this.fighters[slot];
    const foe = this.fighters[1 - slot];
    switch (e.t) {
      case "swing":
        sfx.swing();
        break;
      case "jump":
        sfx.jump();
        break;
      case "land":
        sfx.land();
        this.fx.dust(me.x);
        break;
      case "throw":
        sfx.special();
        break;
      case "hit": {
        const heavy = e.kind === "uppercut" || e.kind === "special" || e.kind === "sweep";
        this.fx.hit(e.x, e.y, e.blocked, heavy);
        if (e.blocked) sfx.block();
        else sfx.hit(heavy);
        this.hitstop = e.blocked ? 3 : heavy ? 7 : 5;
        foe.takeHit(e.kind, e.blocked, me.x);
        if (this.mode === "cpu") {
          const dmg = e.blocked ? CHIP : DAMAGE[e.kind];
          this.hp[1 - slot] = Math.max(0, this.hp[1 - slot] - dmg);
        } else {
          // Our own blow: hold the puppet's predicted reaction a moment so a
          // slice sent before it felt the hit does not snap it back upright.
          const feed = this.feeds[1 - slot];
          if (feed) feed.hold = 10;
        }
        break;
      }
      case "action":
        if (this.mode === "net" && slot === this.local) this.transact(slot, e.kind, e.hit, e.blocked);
        break;
    }
  }

  /** One finished action → one transaction. */
  private transact(slot: 0 | 1, kind: MoveKind, hit: boolean, blocked: boolean) {
    if (!this.net || this.phase !== "fight") return;
    this.seq += 1;
    const id = this.seq;
    const me = this.fighters[slot];
    if (hit) {
      const key = `${SEATS[slot]}:${id}`;
      const damage = blocked ? CHIP : DAMAGE[kind];
      this.pending.set(key, { target: (1 - slot) as 0 | 1, damage, at: performance.now() });
      this.myHits.push([id, MOVE_KINDS.indexOf(kind), blocked ? 1 : 0]);
      if (this.myHits.length > 8) this.myHits.shift();
    }
    const x = me.x;
    this.net
      .act({ match: this.match, round: this.round, id, kind, hit, blocked })
      .then((ms) => this.fx.tag(x, 120, `TX ✓ ${ms}ms`, "#a5ff11"))
      .catch(() => this.fx.tag(x, 120, "TX ✗", "#ff6a5a"));
  }

  // ── puppets ────────────────────────────────────────────────────────────

  private readFeeds() {
    for (const slot of [0, 1] as const) {
      if (slot === this.local) continue;
      const feed = this.feeds[slot];
      if (!feed) continue;
      const s = feed.slice;
      if (s.m !== this.match || s.r !== this.round) continue;
      // Blows this fighter says it landed.
      for (const [id, kindIdx, blocked] of s.h) {
        const key = `${s.seat}:${id}`;
        if (this.seen.has(key)) continue;
        this.seen.add(key);
        const kind = MOVE_KINDS[kindIdx] ?? "punch";
        const target = (1 - slot) as 0 | 1;
        if (!this.counted.has(key)) {
          this.pending.set(key, { target, damage: blocked ? CHIP : DAMAGE[kind], at: performance.now() });
        }
        if (this.phase === "fight" || this.phase === "ko") {
          const victim = this.fighters[target];
          const heavy = kind === "uppercut" || kind === "special" || kind === "sweep";
          if (target === this.local || this.mode === "spectate") {
            victim.takeHit(kind, blocked === 1, s.x);
            this.fx.hit(victim.x - Math.sign(victim.x - s.x) * 10, victim.y + 70, blocked === 1, heavy);
            if (blocked) sfx.block();
            else sfx.hit(heavy);
            this.hitstop = blocked ? 3 : heavy ? 7 : 5;
          }
        }
      }
    }
  }

  private stepPuppet(slot: 0 | 1) {
    const f = this.fighters[slot];
    const feed = this.feeds[slot];
    if (!feed) {
      f.idleStep();
      return;
    }
    const s = feed.slice;
    const since = Math.min(8, this.tick - feed.tick);
    const tx = s.x + s.vx * since;
    f.x += (tx - f.x) * 0.4;
    f.y += (s.y - f.y) * 0.5;
    if (Math.abs(f.y) < 0.2) f.y = 0;
    f.vy = s.vy;
    if (feed.hold > 0) {
      feed.hold -= 1;
      f.frame += 1;
    } else {
      if (f.state !== s.s) f.state = s.s as Fighter["state"];
      f.frame = s.k + (this.tick - feed.tick);
      f.facing = s.f;
    }
    if (f.state === "walk") f.walk += 0.22 * Math.sign(s.vx * s.f || 1);
    if (f.flash > 0) f.flash -= 1;
    f.projectile = s.p ? { x: s.p[0] + s.p[2] * since, y: s.p[1], vx: s.p[2], age: 0 } : null;
  }

  private publish() {
    if (!this.net || this.local === null) return;
    const f = this.fighters[this.local];
    this.sliceN += 1;
    const r = (n: number) => Math.round(n * 10) / 10;
    this.net.publish({
      v: 1,
      seat: SEATS[this.local],
      m: this.match,
      r: this.round,
      x: r(f.x),
      y: r(f.y),
      vx: r(f.vx),
      vy: r(f.vy),
      f: f.facing,
      s: f.state,
      k: f.frame,
      fi: f.def.id,
      p: f.projectile ? [r(f.projectile.x), r(f.projectile.y), r(f.projectile.vx)] : null,
      h: this.myHits,
      n: this.sliceN,
    });
  }

  /** Is the other fighter's stream live? */
  private opponentLive(): boolean {
    if (this.mode === "cpu") return true;
    if (this.mode === "spectate") return this.feeds.some((f) => f && performance.now() - f.at < STALE_MS);
    const feed = this.feeds[1 - (this.local ?? 0)];
    return !!feed && performance.now() - feed.at < STALE_MS;
  }

  // ── phases ─────────────────────────────────────────────────────────────

  private enter(phase: Phase) {
    this.phase = phase;
    this.phaseFrame = 0;
  }

  private resetRoundBookkeeping() {
    this.pending.clear();
    this.seen.clear();
    this.myHits = [];
  }

  private startIntro() {
    this.enter("intro");
    this.koLoser = null;
    this.koDouble = false;
    this.koConfirmed = false;
    this.fx.clear();
    this.fighters[0].reset(START_X[0], 1);
    this.fighters[1].reset(START_X[1], -1);
    if (this.mode === "cpu") this.hp = [MAX_HP, MAX_HP];
    this.trail = [1, 1];
    announce(`Round ${this.round + 1}`);
  }

  private startKo(loser: 0 | 1 | null, double: boolean) {
    this.enter("ko");
    this.koLoser = loser;
    this.koDouble = double;
    this.koConfirmed = this.mode === "cpu";
    const [a, b] = this.fighters;
    if (double) {
      a.knockOut(b.x);
      b.knockOut(a.x);
    } else if (loser !== null) {
      this.fighters[loser].knockOut(this.fighters[1 - loser].x);
    }
    // A puppet falls now; its own stream catches up a moment later.
    for (const feed of this.feeds) if (feed) feed.hold = 40;
    this.fx.kick(14, 4);
    sfx.ko();
    this.hitstop = 10;
  }

  private showOver() {
    this.enter("over");
    const w = this.winner === "p1" ? 0 : this.winner === "p2" ? 1 : null;
    if (w !== null) {
      this.fighters[w].win();
      if (this.fighters[1 - w].state !== "ko") this.fighters[1 - w].knockOut(this.fighters[w].x);
    }
  }

  private stepPhase() {
    switch (this.phase) {
      case "waiting":
        if (this.state && this.state.status === "fighting" && this.opponentLive()) this.startIntro();
        break;
      case "intro":
        if (this.phaseFrame === 72) announce("Fight!");
        if (this.phaseFrame >= 96) this.enter("fight");
        break;
      case "fight": {
        const out: (0 | 1)[] = ([0, 1] as const).filter((s) => this.shownHp(s) <= 0);
        if (out.length === 2) this.startKo(null, true);
        else if (out.length === 1) this.startKo(out[0], false);
        break;
      }
      case "ko":
        this.stepKo();
        break;
      case "over":
        break;
    }
  }

  private stepKo() {
    const f = this.phaseFrame;
    if (f === 60 && this.koLoser !== null) {
      const w = (1 - this.koLoser) as 0 | 1;
      this.fighters[w].win();
      announce(`${this.names[w] || this.fighters[w].def.name} wins`);
    }
    if (f < 160) return;

    if (this.mode === "cpu") {
      if (this.koLoser !== null) this.rounds[1 - this.koLoser] += 1;
      const done = this.rounds.findIndex((r) => r >= 2);
      if (done >= 0) {
        this.winner = SEATS[done];
        this.flawless = this.hp[done] >= MAX_HP;
        this.showOver();
        announce(this.flawless ? "Flawless victory" : `${this.names[done]} wins`);
      } else {
        this.round += 1;
        this.startIntro();
      }
      return;
    }

    if (this.koConfirmed && this.pendingRound) {
      const next = this.pendingRound;
      this.pendingRound = null;
      this.rounds = next.rounds;
      this.resetRoundBookkeeping();
      if (next.finished) {
        this.showOver();
        if (this.flawless) announce("Flawless victory");
      } else {
        this.round = next.round;
        this.startIntro();
      }
    } else if (f > 160 + 60 * 8) {
      // The knock-out this screen saw never reached the contract — a blow it
      // refused. Get back up and keep fighting.
      for (const fighter of this.fighters) if (fighter.state === "ko" || fighter.state === "victory") fighter.reset(fighter.x, fighter.facing);
      this.pending.clear();
      this.enter("fight");
    }
  }

  // ── health ─────────────────────────────────────────────────────────────

  /** Health as the bars show it: the contract's figure less blows still in flight. */
  shownHp(slot: 0 | 1): number {
    if (this.mode === "cpu") return this.hp[slot];
    let hp = this.contractHp[slot];
    for (const p of this.pending.values()) if (p.target === slot) hp -= p.damage;
    return Math.max(0, hp);
  }

  private settleBars() {
    if (this.mode !== "cpu") {
      const now = performance.now();
      for (const [key, p] of this.pending) {
        if (this.counted.has(key) || now - p.at > PENDING_MS) this.pending.delete(key);
      }
    }
    for (const slot of [0, 1] as const) {
      const hp = this.shownHp(slot) / MAX_HP;
      if (this.trail[slot] < hp) this.trail[slot] = hp;
      else this.trail[slot] = Math.max(hp, this.trail[slot] - 0.005);
    }
  }

  // ── drawing ────────────────────────────────────────────────────────────

  draw(ctx: CanvasRenderingContext2D) {
    const [ox, oy] = this.fx.offset();
    ctx.save();
    ctx.translate(ox, oy);
    drawStage(ctx, this.tick);

    // The one attacking is drawn on top.
    const order: (0 | 1)[] = this.fighters[0].frame < this.fighters[1].frame ? [1, 0] : [0, 1];
    {
      for (const slot of order) {
        const f = this.fighters[slot];
        const pose = poseFor({ state: f.state, frame: f.frame, walk: f.walk, vy: f.vy, airborne: f.airborne, time: this.tick + slot * 37 });
        drawFighter(ctx, f.def, pose, {
          x: f.x,
          y: f.y,
          facing: f.facing,
          grounded: !f.airborne,
          flash: f.flash > 0 && f.flash % 2 === 0,
          time: this.tick + slot * 37,
        });
      }
      for (const f of this.fighters) if (f.projectile) drawProjectile(ctx, f.def, f.projectile, this.tick);
    }
    this.fx.draw(ctx);
    ctx.restore();

    const side = (slot: 0 | 1): HudSide => ({
      name: this.names[slot] || (this.mode === "cpu" ? this.fighters[slot].def.name : "—"),
      hp: this.shownHp(slot) / MAX_HP,
      trail: this.trail[slot],
      rounds: this.rounds[slot],
      online: this.mode === "cpu" || slot === this.local || this.online[slot] || !!this.feeds[slot],
      you: slot === this.local,
    });
    drawHud(ctx, side(0), side(1), `R${this.round + 1}`);
    this.drawAnnouncer(ctx);
  }

  private drawAnnouncer(ctx: CanvasRenderingContext2D) {
    const f = this.phaseFrame;
    switch (this.phase) {
      case "waiting": {
        const s = this.state;
        if (this.mode === "spectate") drawCaption(ctx, "SPECTATING — WAITING FOR THE FIGHTERS");
        else if (!s || s.status === "waiting") drawCaption(ctx, "WAITING FOR AN OPPONENT — SEND THEM THE INVITE LINK");
        else drawCaption(ctx, `WAITING FOR ${(this.names[1 - (this.local ?? 0)] || "YOUR OPPONENT").toUpperCase()} TO CONNECT…`);
        break;
      }
      case "intro":
        if (f < 72) drawBanner(ctx, `ROUND ${this.round + 1}`, "", f);
        else drawBanner(ctx, "FIGHT!", "", f - 72, "red");
        break;
      case "fight":
        if (!this.opponentLive()) drawCaption(ctx, "OPPONENT CONNECTION LOST — WAITING…");
        break;
      case "ko":
        if (f < 60) drawBanner(ctx, this.koDouble ? "DOUBLE K.O." : "K.O.", "", f, "red");
        else if (this.koLoser !== null) {
          const w = 1 - this.koLoser;
          drawBanner(ctx, `${(this.names[w] || this.fighters[w].def.name).toUpperCase()} WINS`, "", f - 60);
        } else drawBanner(ctx, "DRAW", "", f - 60);
        if (f > 160 && !this.koConfirmed) drawCaption(ctx, "CONFIRMING THE KNOCK-OUT WITH THE NODE…");
        break;
      case "over": {
        const w = this.winner === "p1" ? 0 : this.winner === "p2" ? 1 : null;
        const title = w === null ? "DRAW" : `${(this.names[w] || this.fighters[w].def.name).toUpperCase()} WINS`;
        drawBanner(ctx, title, this.flawless ? "FLAWLESS VICTORY" : "", Math.min(f, 20), w === this.local ? "lime" : "gold");
        drawCaption(ctx, this.mode === "cpu" ? "PRESS ENTER FOR A REMATCH" : this.mode === "spectate" ? "MATCH OVER" : "CALL A REMATCH FROM THE PANEL");
        break;
      }
    }
  }

  /** Practice: start over. */
  restart() {
    if (this.mode !== "cpu") return;
    this.rounds = [0, 0];
    this.round = 0;
    this.winner = "";
    this.flawless = false;
    this.startIntro();
  }

  get over(): boolean {
    return this.phase === "over";
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  get roundsWon(): [number, number] {
    return [this.rounds[0], this.rounds[1]];
  }
}
