import { describe, expect, it } from "vitest";
import { KEYFRAME_COST_RATIO as TS_RATIO } from "./capacity";
import { KEYFRAME_COST_RATIO as JS_RATIO } from "../../e2e/lib/workload.mjs";

/**
 * The capacity ladder must model exactly what the app publishes, or its measured
 * numbers describe a stream nobody sends. It cannot import `lib/capacity.ts` — it
 * is plain `.mjs` run by `node` with no build step — so the constants it needs are
 * duplicated in `e2e/lib/workload.mjs` and held here.
 *
 * This exists because the ladder previously carried the ratio as a bare literal
 * under a comment claiming the two "agree by construction rather than by
 * coincidence". Nothing enforced that. A comment asserting a guarantee nobody
 * checks is worse than no comment, and the same PR had already fixed exactly this
 * shape of drift for the wire format (see frameParity.test.ts) — so the fix is the
 * guard, not a reworded comment.
 */
describe("workload parity: capacity.ts vs e2e/lib/workload.mjs", () => {
  it("agrees on KEYFRAME_COST_RATIO", () => {
    expect(JS_RATIO).toBe(TS_RATIO);
  });

  it("still holds a plausible ratio, so drift cannot pass by both going wrong", () => {
    // 5-10 is the usual range for 480p H.264; a value outside it means someone
    // changed the model rather than fixing a mismatch.
    expect(TS_RATIO).toBeGreaterThanOrEqual(5);
    expect(TS_RATIO).toBeLessThanOrEqual(10);
  });
});
