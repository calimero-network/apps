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
    const def = {
      title: "Lunch\nnext: forged line",
      options: ["Pizza", "Sushi 🍣", "Tacos"],
      min_choices: 1,
      max_choices: 2,
    } as Transcript["definition"];
    const text = transcriptText(
      "00".repeat(32),
      def,
      "aa".repeat(32),
      [
        { trustee: "11".repeat(32), share: "bb".repeat(32) },
        { trustee: "22".repeat(32), share: "cc".repeat(32) },
      ],
      [{ voter: "33".repeat(32), digest: "dd".repeat(32) }],
      [
        { trustee: "11".repeat(32), options: ["e1", "e2", "e3"].map((d) => ({ d: d.repeat(32) })) },
        { trustee: "22".repeat(32), options: ["f1", "f2", "f3"].map((d) => ({ d: d.repeat(32) })) },
      ],
      [1, 0, 1],
    );
    expect(transcriptDigest(text)).toBe("54f905551c4dbf1a70ac8f6d87a3063ec15f5cef3f6b550ff9fb0e173c3b6195");
  });
});

/** A transcript shaped exactly like `get_transcript`, built from the vectors. */
function buildTranscript(): Transcript {
  const trustees = V.shares.map((s: { trustee: string }) => s.trustee);
  const definition = {
    title: "Vectors",
    description: "",
    options: ["a", "b", "c"],
    min_choices: V.rules.min,
    max_choices: V.rules.max,
    trustees,
    voters: [],
    creator: trustees[0],
    created_at: 0,
    closes_at: null,
  };
  const counted = V.ballots.map((b: { voter: string; digest: string }) => ({ voter: b.voter, digest: b.digest, frozen: "" }));
  const partials = V.partials.map((p: { trustee: string; options: unknown[] }) => ({ trustee: p.trustee, options: p.options }));
  const shares = V.shares.map((s: { trustee: string; share: string; proof: unknown }) => ({
    trustee: s.trustee,
    share: s.share,
    proof: s.proof,
  }));
  const text = transcriptText(V.poll_id, definition as Transcript["definition"], V.election_key, shares, counted, partials, V.counts);
  return {
    protocol: "mero-vote/v1/",
    poll_id: V.poll_id,
    definition,
    state: {
      phase: "Closed",
      election: { key: V.election_key, shares, opened_at: 0 },
      closure: { counted, closed_at: 0 },
      anchor: null,
    },
    ballots: V.ballots.map((b: { voter: string; digest: string; ballot: unknown }) => ({
      voter: b.voter,
      digest: b.digest,
      ballot: b.ballot,
      endorsed: true,
    })),
    partials,
    report: {
      poll_id: V.poll_id,
      phase: "Closed",
      verified: true,
      checks: [],
      counts: V.counts,
      counted_ballots: V.ballots.length,
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

  it("catches a forged partial decryption", () => {
    const t = vectorTranscript();
    const p = t.partials[0]!;
    [p.options[0], p.options[1]] = [p.options[1]!, p.options[0]!];
    expect(verifyTranscript(t).verified).toBe(false);
  });

  it("catches an anchor for a different digest", () => {
    const t = vectorTranscript();
    t.state.anchor = { digest: "00".repeat(32), network: "x", reference: "y", anchored_at: 0 };
    expect(verifyTranscript(t).checks.find((c) => c.name === "anchor")?.ok).toBe(false);
  });

  it("withholds the count while a trustee is missing", () => {
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
