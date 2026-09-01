// ── Workload constants shared with the app ────────────────────────────────────
//
// The capacity ladder has to model exactly what the app publishes, or its numbers
// describe a stream nobody sends. That means it needs a couple of values that
// `src/lib/capacity.ts` owns — and it cannot import them, because it is plain
// `.mjs` run straight by `node` with no build step.
//
// So they live here, once, and `src/lib/workloadParity.test.ts` asserts they
// equal the TypeScript originals. The ladder previously carried
// `KEYFRAME_COST_RATIO` as a bare literal with a comment claiming the two "agree
// by construction rather than by coincidence" — which was not true of anything: it
// was a copy-pasted number with no shared source and no test tying them together.
// A comment asserting a guarantee nobody enforces is worse than no comment.

/**
 * Bytes a keyframe costs relative to a delta frame. Mirrors
 * `KEYFRAME_COST_RATIO` in src/lib/capacity.ts.
 */
export const KEYFRAME_COST_RATIO = 8;
