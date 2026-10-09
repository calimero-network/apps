/**
 * The practice CPU. Not clever — it closes distance, mixes its attacks, blocks
 * some of what it sees coming, and throws its special from range. Reaction
 * time keeps it beatable.
 */
import { NO_INPUT, type Fighter, type Input } from "./sim";

const REACT = 14;

export class Cpu {
  private plan: Input = { ...NO_INPUT };
  private hold = 0;
  private wait = 0;

  think(me: Fighter, foe: Fighter): Input {
    const dist = Math.abs(foe.x - me.x);
    const toward = Math.sign(foe.x - me.x) || 1;
    const fwd = (on: boolean): Partial<Input> => (toward > 0 ? { right: on } : { left: on });
    const back = (on: boolean): Partial<Input> => (toward > 0 ? { left: on } : { right: on });

    if (this.hold > 0) {
      this.hold -= 1;
      const out = this.plan;
      // Attack buttons are edges: fire once, then keep holding the rest.
      this.plan = { ...this.plan, punch: false, kick: false, special: false, up: false };
      return out;
    }
    if (this.wait > 0) {
      this.wait -= 1;
      return NO_INPUT;
    }

    const threatened = ["punch", "kick", "uppercut", "sweep", "air_kick"].includes(foe.state) || !!foe.projectile;
    const r = Math.random();
    let plan: Input = { ...NO_INPUT };
    let hold = 6;

    if (threatened && dist < 90 && r < 0.45) {
      plan = { ...NO_INPUT, block: true };
      hold = 18;
    } else if (foe.projectile && Math.abs(foe.projectile.x - me.x) < 120 && r < 0.6) {
      plan = { ...NO_INPUT, up: true, ...fwd(true) };
      hold = 4;
    } else if (dist > 150) {
      if (r < 0.12 && me.specialCd === 0) plan = { ...NO_INPUT, special: true };
      else if (r < 0.2) plan = { ...NO_INPUT, up: true, ...fwd(true) };
      else {
        plan = { ...NO_INPUT, ...fwd(true) };
        hold = 16;
      }
    } else if (dist > 58) {
      if (r < 0.15) plan = { ...NO_INPUT, up: true, ...fwd(true) };
      else if (r < 0.25 && me.specialCd === 0) plan = { ...NO_INPUT, special: true };
      else {
        plan = { ...NO_INPUT, ...fwd(true) };
        hold = 10;
      }
    } else {
      if (r < 0.28) plan = { ...NO_INPUT, punch: true };
      else if (r < 0.5) plan = { ...NO_INPUT, kick: true };
      else if (r < 0.62) plan = { ...NO_INPUT, down: true, punch: true };
      else if (r < 0.74) plan = { ...NO_INPUT, down: true, kick: true };
      else if (r < 0.86) {
        plan = { ...NO_INPUT, ...back(true) };
        hold = 12;
      } else {
        plan = { ...NO_INPUT, block: true };
        hold = 14;
      }
    }

    // Jumping in: kick on the way down.
    if (me.state === "jump" && me.vy < 1 && dist < 80) plan = { ...NO_INPUT, kick: true };

    this.plan = plan;
    this.hold = hold;
    this.wait = REACT + Math.floor(Math.random() * 10);
    return plan;
  }
}
