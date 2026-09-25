import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Transcript } from "../generated/MeroVoteClient";
import { transcriptDigest, transcriptText, verifyTranscript } from "./verify";

const HERE = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(
  readFileSync(resolve(HERE, "..", "..", "..", "logic", "crates", "crypto", "vectors.json"), "utf8"),
);


describe("transcript text", () => {
  it("matches the contract's digest for the pinned inputs", () => {
    // Same inputs as `transcript_digest_is_pinned` in logic/src/tests.rs.
    const dealing = (c: string) => ({ commitments: [c.repeat(32), `${c}ff`.repeat(16)] });
    const text = transcriptText(
      "00".repeat(32),
      {
        title: "Lunch\nnext: forged line",
        options: ["Pizza", "Sushi 🍣", "Tacos"],
        min_choices: 1,
        max_choices: 2,
        trustees: ["11".repeat(32), "22".repeat(32), "44".repeat(32)],
      },
      {
        key: "aa".repeat(32),
        threshold: 2,
        qualified: [
          { dealer: "11".repeat(32), dealing: dealing("b1") },
          { dealer: "22".repeat(32), dealing: dealing("b2") },
        ],
        disqualified: ["44".repeat(32)],
      },
      [{ voter: "33".repeat(32), digest: "dd".repeat(32) }],
      [1, 0, 1],
    );
    expect(transcriptDigest(text)).toBe("e14b512be7a2a5580cbc247fd7851682f435b0b32a91045708848c29cea5abdc");
  });
});

/** A transcript shaped exactly like `get_transcript`, built from the vectors:
 *  a 2-of-3 election decrypted by trustees #1 and #3. */
function buildTranscript(): Transcript {
  const definition = {
    title: "Vectors",
    description: "",
    options: ["a", "b", "c"],
    min_choices: V.rules.min,
    max_choices: V.rules.max,
    trustees: V.trustees,
    threshold: V.threshold,
    voters: [],
    creator: V.trustees[0],
    created_at: 0,
    closes_at: null,
  };
  const counted = V.ballots.map((b: { voter: string; digest: string }) => ({ voter: b.voter, digest: b.digest, frozen: "" }));
  const election = {
    key: V.election_key,
    threshold: V.threshold,
    transport: V.transport.map((t: { key: string }) => t.key),
    qualified: V.dealings.map((d: { dealer: string; dealing: unknown }) => ({ dealer: d.dealer, dealing: d.dealing })),
    disqualified: [] as string[],
    opened_at: 0,
  };
  const text = transcriptText(V.poll_id, definition as Transcript["definition"], election, counted, V.counts);
  return {
    protocol: "mero-vote/v2/",
    poll_id: V.poll_id,
    definition,
    state: { phase: "Closed", election, closing_at: 0, closure: { counted, closed_at: 0 }, anchor: null },
    ballots: V.ballots.map((b: { voter: string; digest: string; ballot: unknown }) => ({
      voter: b.voter,
      digest: b.digest,
      ballot: b.ballot,
      endorsed: true,
    })),
    partials: V.partials.map((p: { trustee: string; index: number; options: unknown[] }) => ({
      trustee: p.trustee,
      index: p.index,
      options: p.options,
    })),
    report: {
      poll_id: V.poll_id,
      phase: "Closed",
      verified: true,
      checks: [],
      counts: V.counts,
      counted_ballots: V.ballots.length,
      decrypted_by: [V.trustees[0], V.trustees[2]],
      transcript_digest: transcriptDigest(text),
      anchor: null,
    },
  } as unknown as Transcript;
}

/** Fresh every call: the tamper tests mutate what they are given. */
const vectorTranscript = (): Transcript => structuredClone(buildTranscript());

describe("verifyTranscript", () => {
  it("re-counts a clean poll and agrees with the node", () => {
    const audit = verifyTranscript(vectorTranscript());
    expect(audit.checks.filter((c) => !c.ok)).toEqual([]);
    expect(audit.counts).toEqual(V.counts);
    expect(audit.agreesWithNode).toBe(true);
  });

  it("catches a swapped ciphertext", () => {
    const t = vectorTranscript();
    const [x, y] = [t.ballots[0]!.ballot.choices[0]!, t.ballots[1]!.ballot.choices[0]!];
    t.ballots[0]!.ballot.choices[0] = y;
    t.ballots[1]!.ballot.choices[0] = x;
    const audit = verifyTranscript(t);
    expect(audit.verified).toBe(false);
    expect(audit.counts).toBeNull();
    expect(audit.agreesWithNode).toBe(false);
  });

  it("catches a node that reports a different count", () => {
    const t = vectorTranscript();
    t.report.counts = [3, 0, 1];
    expect(verifyTranscript(t).agreesWithNode).toBe(false);
  });

  it("sets a forged partial aside, and withholds the count if that leaves fewer than t", () => {
    const t = vectorTranscript();
    const p = t.partials[0]!;
    [p.options[0], p.options[1]] = [p.options[1]!, p.options[0]!];
    const audit = verifyTranscript(t);
    expect(audit.counts).toBeNull();
    expect(audit.checks.find((c) => c.name === "partial decryptions")?.detail).toContain("set aside");
  });

  it("rejects a dealing whose constant term is swapped for a rogue key", () => {
    const t = vectorTranscript();
    const q = t.state.election!.qualified;
    q[1]!.dealing.commitments[0] = q[0]!.dealing.commitments[0]!;
    expect(verifyTranscript(t).verified).toBe(false);
  });

  it("catches an anchor for a different digest", () => {
    const t = vectorTranscript();
    t.state.anchor = { digest: "00".repeat(32), network: "x", reference: "y", anchored_at: 0 };
    expect(verifyTranscript(t).checks.find((c) => c.name === "anchor")?.ok).toBe(false);
  });

  it("withholds the count below the threshold", () => {
    const t = vectorTranscript();
    t.partials = t.partials.slice(0, 1);
    t.report.counts = null;
    t.report.transcript_digest = null;
    const audit = verifyTranscript(t);
    expect(audit.verified).toBe(true);
    expect(audit.counts).toBeNull();
    expect(audit.agreesWithNode).toBe(true);
  });
});
