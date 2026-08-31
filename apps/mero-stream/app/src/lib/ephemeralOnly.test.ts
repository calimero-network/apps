import { describe, expect, it } from "vitest";
// Vite's `?raw` rather than node:fs. Two reasons: the app tsconfig has no node
// types (so `readFileSync`/`__dirname` do not type-check here), and a `?raw`
// import is resolved by the SAME bundler the app builds with — so if a file is
// renamed, this fails at build time rather than at runtime with a path that
// silently no longer exists.
import liveStreamSource from "../hooks/useLiveStream.ts?raw";
import callPageSource from "../pages/CallPage.tsx?raw";
import meroStreamSource from "../hooks/useMeroStream.ts?raw";

/**
 * ── The ephemeral-only invariant, as a test ──────────────────────────────────
 *
 * The call used to carry a runtime switch between two transports: `post_chunk`,
 * which writes every access unit into replicated state, and ephemeral presence,
 * which writes nothing. The switch is gone and it must stay gone. This is a
 * product decision, not a preference: on the contract path a 25 fps call becomes
 * ~188 KB/s of permanently-stored, tombstone-generating state, plus a WASM run
 * per frame and a second round-trip on receive to read back bytes the
 * notification could have carried.
 *
 * Every other test here checks behaviour. This one checks that an architectural
 * decision has not quietly regressed, and it reads SOURCE TEXT to do it — which
 * deserves a justification, because it is an unusual shape:
 *
 *   * The thing being protected is the ABSENCE of a call. There is no behaviour
 *     to assert on: a hook that started writing chunks again would still decode,
 *     still render, still pass every functional test, and only show up as a
 *     surprise on a node's disk usage weeks later.
 *   * Mocking `postChunk` and asserting it is never called would need the whole
 *     hook harness — WebCodecs, a camera, a node session — and would still only
 *     cover the paths the harness happened to drive.
 *   * The failure it guards against is a plausible one: `useMeroStream` still
 *     EXPOSES `postChunk` and `getChunks` on purpose, because `/stream` and the
 *     recorded Task-3 measurements need them. So the wrappers are one autocomplete
 *     away at all times.
 *
 * It is deliberately narrow. It does not forbid the strings anywhere in the app,
 * only a live call to them from the two files that make up the call path, and it
 * ignores comments — the history of why the contract path was removed is worth
 * keeping written down next to the code that removed it.
 */

const SOURCES: Record<string, string> = {
  "hooks/useLiveStream.ts": liveStreamSource,
  "pages/CallPage.tsx": callPageSource,
  "hooks/useMeroStream.ts": meroStreamSource,
};

function readSource(relative: string): string {
  const source = SOURCES[relative];
  // A missing key means a rename slipped past the imports above; failing loudly
  // beats asserting against an empty string, which would pass everything.
  if (!source) throw new Error(`no source registered for ${relative}`);
  return source;
}

/**
 * Strip `//` and block comments so a historical mention does not read as a call.
 *
 * Not a real parser, and it does not need to be: it runs over two files whose
 * content this repo controls. The one case it would get wrong — a `//` inside a
 * string literal — cannot produce a false PASS, only a false failure, which a
 * human would see immediately.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CALL_PATH = ["hooks/useLiveStream.ts", "pages/CallPage.tsx"];

describe("the call path is ephemeral-only", () => {
  it.each(CALL_PATH)("%s never calls the contract chunk API", (file) => {
    const code = stripComments(readSource(file));
    // Call sites, not mentions: `postChunk(` / `.postChunk(` etc. The contract
    // methods themselves stay in the contract and in useMeroStream — see the
    // module note above for why that is deliberate rather than an oversight.
    for (const method of [
      "postChunk",
      "getChunks",
      "pruneChunks",
      "keyframeCursors",
    ]) {
      expect(
        code,
        `${file} calls ${method}() — the call path must not touch replicated state`,
      ).not.toMatch(new RegExp(`\\b${method}\\s*\\(`));
    }
  });

  it.each(CALL_PATH)("%s publishes only through set_ephemeral", (file) => {
    const code = stripComments(readSource(file));
    // `post_chunk` is the JSON-RPC method name; seeing it outside a comment in
    // the call path means someone reintroduced the raw call.
    expect(code).not.toContain("post_chunk");
  });

  it("useLiveStream has no transport switch left", () => {
    const code = stripComments(readSource("hooks/useLiveStream.ts"));
    for (const token of ["LiveTransport", "setTransport", "transportRef"]) {
      expect(code, `${token} is back in useLiveStream`).not.toContain(token);
    }
  });

  it("the call page offers no transport toggle", () => {
    const code = readSource("pages/CallPage.tsx");
    // Test ids, because that is what a switch would need to be operable and what
    // the old one actually had.
    for (const id of [
      "transport-switch",
      "transport-contract",
      "transport-ephemeral",
    ]) {
      expect(code, `a ${id} control is back on the call page`).not.toContain(
        id,
      );
    }
  });

  it("still reaches set_ephemeral, so this test cannot pass vacuously", () => {
    // Without this, deleting the send path entirely would satisfy every
    // assertion above. A guard against a call that writes nothing is worthless
    // if it also passes for a call that sends nothing.
    const hook = readSource("hooks/useLiveStream.ts");
    expect(hook).toMatch(/ephemeral\.set\b/);
    expect(hook).toContain("publishEphemeralFrame");
  });

  it("keeps the contract wrappers available OUTSIDE the call path", () => {
    // The other half of the decision, asserted so a future cleanup does not
    // delete the measured Task-3 baseline by accident: `/stream` and the
    // recorded numbers depend on these existing.
    const wrappers = readSource("hooks/useMeroStream.ts");
    expect(wrappers).toMatch(/\bpostChunk\b/);
    expect(wrappers).toMatch(/\bgetChunks\b/);
  });
});
