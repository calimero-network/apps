// Writes vectors.json: the web client's ballot cryptography, run from fixed
// seeds, for the native iOS and Android ports to replay byte for byte.
//
//   pnpm install --filter mero-vote        # once, for @noble/curves and @noble/hashes
//   node apps/mero-vote/mobile/test-vectors/generate.mjs
//
// It imports the web app's own `app/src/crypto/protocol.ts` and `verify.ts`
// (Node 22.18+ strips the types), so the vectors ARE the web client's output:
// nothing here re-implements a primitive. Every random draw comes from the
// protocol's `seededRng`, which both native ports implement too.
//
// Never edit vectors.json by hand. After a protocol change, re-run this and
// make both native test suites pass again.
import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// verify.ts imports "./protocol" with no extension (Vite resolves it); teach
// Node's resolver the same, for relative specifiers only.
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (e) {
    if (specifier.startsWith(".") && !/\\.[cm]?[jt]s$/.test(specifier)) return next(specifier + ".ts", context);
    throw e;
  }
}`),
  pathToFileURL("./"),
);

const HERE = dirname(fileURLToPath(import.meta.url));
const CRYPTO = resolve(HERE, "..", "..", "app", "src", "crypto");
const P = await import(pathToFileURL(resolve(CRYPTO, "protocol.ts")).href);
const { verifyTranscript, transcriptText, transcriptDigest } = await import(
  pathToFileURL(resolve(CRYPTO, "verify.ts")).href
);
const { sha256 } = await import("@noble/hashes/sha2.js").catch(() =>
  import(pathToFileURL(resolve(HERE, "..", "..", "app", "node_modules", "@noble", "hashes", "sha2.js")).href),
);

const enc = new TextEncoder();
const hex = (b) => P.toHex(b);
const account = (name) => hex(sha256(enc.encode(`account:${name}`)));
const br = (b) => P.branchToWire(b);

// ── primitives ─────────────────────────────────────────────────────────────

const multiples = [];
let acc = P.IDENTITY;
for (let k = 0; k < 16; k++) {
  multiples.push(P.encodePoint(acc));
  acc = acc.add(P.BASE);
}

// Encodings the decoder must accept or refuse exactly as noble does.
const candidates = [
  "00".repeat(32),
  "01" + "00".repeat(31), // s = 1 is negative
  "02" + "00".repeat(31),
  "ed" + "ff".repeat(30) + "7f", // p: not canonical
  "ff".repeat(32),
  "ff".repeat(31) + "7f",
  ...multiples.slice(1, 4),
];
for (let i = 0; i < 24; i++) candidates.push(hex(sha256(enc.encode(`candidate:${i}`))));
const decoding = candidates.map((s) => {
  let ok = true;
  try {
    P.decodePoint(s);
  } catch {
    ok = false;
  }
  return { hex: s, valid: ok };
});

const scalarDecoding = [
  "00".repeat(32),
  P.encodeScalar(P.L - 1n),
  P.toHex(new Uint8Array([...Array(32)].map((_, i) => Number((P.L >> BigInt(8 * i)) & 0xffn)))), // ℓ
  "ff".repeat(32),
].map((s) => {
  let ok = true;
  try {
    P.decodeScalar(s);
  } catch {
    ok = false;
  }
  return { hex: s, valid: ok };
});

// Scalar arithmetic and scalar multiplication on drawn values.
const arith = [];
{
  const rng = P.seededRng("arith");
  for (let i = 0; i < 8; i++) {
    const a = rng();
    const b = rng();
    arith.push({
      a: P.encodeScalar(a),
      b: P.encodeScalar(b),
      sum: P.encodeScalar(a + b),
      difference: P.encodeScalar(a - b),
      product: P.encodeScalar(a * b),
      a_times_base: P.encodePoint(P.BASE.multiply(a)),
      b_times_a_base: P.encodePoint(P.BASE.multiply(a).multiply(b)),
    });
  }
}

const hashCases = [
  { domain: "choice", parts: ["poll", "voter"] },
  { domain: "sum", parts: [] },
  { domain: "test-rng", parts: ["seed", "éè"] },
].map((h) => ({
  ...h,
  scalar: P.encodeScalar(P.hashToScalar(h.domain, h.parts.map((p) => enc.encode(p)))),
  digest: hex(P.hashToDigest(h.domain, h.parts.map((p) => enc.encode(p)))),
}));

const rng0 = P.seededRng("mero-vote-mobile");
const rngFirst = [rng0(), rng0(), rng0(), rng0()].map(P.encodeScalar);

const lagrangeSets = [
  [1, 2],
  [1, 3],
  [2, 3, 5],
  [1, 2, 3, 4],
].map((set) => ({ set, coefficients: set.map((i) => P.encodeScalar(P.lagrangeAtZero(i, set))) }));

// ── a whole poll ───────────────────────────────────────────────────────────

const pollId = hex(sha256(enc.encode("mero-vote-mobile/poll")));
const names = ["alice", "bob", "carol"];
const trustees = names.map(account);
const threshold = 2;

const transport = trustees.map((t, j) => {
  const seed = `transport:${j + 1}`;
  const rng = P.seededRng(seed);
  const e = rng();
  const [key, proof] = P.makeTransportKey(pollId, t, e, rng);
  return { trustee: t, seed, secret: P.encodeScalar(e), key: P.encodePoint(key), proof: br(proof) };
});
const keys = transport.map((t) => P.decodePoint(t.key));

const dealings = trustees.map((dealer, j) => {
  const seed = `deal:${j + 1}`;
  const d = P.deal(pollId, dealer, threshold, keys, P.seededRng(seed));
  return { dealer, seed, dealing: P.dealingToWire(d), parsed: d };
});
const parsed = dealings.map((d) => d.parsed);
const electionKey = P.jointKey(parsed);
const combined = trustees.map((_, j) => {
  const e = P.decodeScalar(transport[j].secret);
  let x = 0n;
  dealings.forEach((d) => {
    x += P.openShare(pollId, d.dealer, j + 1, e, d.parsed);
  });
  return P.mod(x);
});
const shares = trustees.map((_, j) =>
  dealings.map((d) => P.encodeScalar(P.openShare(pollId, d.dealer, j + 1, P.decodeScalar(transport[j].secret), d.parsed))),
);

// Carol cheats Alice: share 1 of her dealing is off by one.
const cheat = P.dealingFromWire(dealings[2].dealing);
cheat.shares[0] = { r: cheat.shares[0].r, v: P.mod(cheat.shares[0].v + 1n) };
const complaintSeed = "complaint:1";
const [cSecret, cProof] = P.makeComplaint(
  pollId,
  trustees[0],
  trustees[2],
  1,
  P.decodeScalar(transport[0].secret),
  cheat,
  P.seededRng(complaintSeed),
);

const rules = { options: 3, min: 0, max: 2 };
const voterNames = ["alice", "bob", "carol", "dave", "erin"];
const selections = [
  [true, false, false],
  [true, true, false],
  [false, false, false],
  [false, true, true],
  [true, false, true],
];
const ballots = voterNames.map((n, i) => {
  const voter = account(n);
  const seed = `ballot:${i + 1}`;
  const b = P.castBallot(electionKey, pollId, voter, rules, selections[i], P.seededRng(seed));
  return { voter, seed, selection: selections[i], ballot: P.ballotToWire(b), digest: P.ballotDigest(pollId, voter, b), parsed: b };
});
let agg = Array.from({ length: rules.options }, P.zeroCt);
for (const b of ballots) agg = agg.map((ct, j) => P.addCt(ct, b.parsed.choices[j].ct));

// Alice (1) and Carol (3) decrypt: a non-consecutive set, so Lagrange matters.
const partials = [0, 2].map((j) => {
  const seed = `partial:${j + 1}`;
  const rng = P.seededRng(seed);
  const options = agg.map((ct, o) => {
    const [d, proof] = P.partialDecrypt(pollId, trustees[j], o, combined[j], ct.a, rng);
    return { d: P.encodePoint(d), proof: br(proof) };
  });
  return { trustee: trustees[j], index: j + 1, seed, options };
});
const counts = agg.map((ct, o) =>
  P.openCount(
    ct,
    partials.map((p) => [p.index, P.decodePoint(p.options[o].d)]),
    ballots.length,
  ),
);

// Single-choice rules too: exactly one of four.
const single = { options: 4, min: 1, max: 1 };
const singleBallots = [0, 3].map((pick, i) => {
  const voter = account(`single:${i}`);
  const seed = `single:${i}`;
  const selection = [0, 1, 2, 3].map((k) => k === pick);
  const b = P.castBallot(electionKey, pollId, voter, single, selection, P.seededRng(seed));
  return { voter, seed, selection, ballot: P.ballotToWire(b), digest: P.ballotDigest(pollId, voter, b) };
});

// ── the transcript `get_transcript` returns, and the web's re-audit of it ─

const definition = {
  title: "Where do we hold the offsite? — été",
  description: "Pick up to two.",
  options: ["Lisbon", "Zagreb", "Kyoto"],
  min_choices: rules.min,
  max_choices: rules.max,
  trustees,
  threshold,
  voters: [],
  creator: trustees[0],
  created_at: 1761000000000,
  closes_at: null,
};
const election = {
  key: P.encodePoint(electionKey),
  threshold,
  transport: transport.map((t) => t.key),
  qualified: dealings.map((d) => ({ dealer: d.dealer, dealing: d.dealing })),
  disqualified: [],
  opened_at: 1761000001000,
};
const counted = ballots.map((b) => ({ voter: b.voter, digest: b.digest, frozen: b.digest }));
const digest = transcriptDigest(transcriptText(pollId, definition, election, counted, counts));
const transcript = {
  protocol: P.PROTOCOL,
  poll_id: pollId,
  definition,
  state: {
    phase: "Closed",
    election,
    closing_at: 1761000002000,
    closure: { counted, closed_at: 1761000003000 },
    anchor: null,
  },
  ballots: ballots.map((b) => ({ voter: b.voter, digest: b.digest, ballot: b.ballot, endorsed: true })),
  partials: partials.map((p) => ({ trustee: p.trustee, index: p.index, options: p.options })),
  report: {
    poll_id: pollId,
    phase: "Closed",
    verified: true,
    checks: [],
    counts,
    counted_ballots: counted.length,
    decrypted_by: partials.map((p) => p.trustee),
    transcript_digest: digest,
    anchor: null,
    uncounted: [],
  },
};

// Variants the re-audit must judge exactly as the web does.
const clone = (x) => JSON.parse(JSON.stringify(x));
const tamperedBallot = clone(transcript);
tamperedBallot.ballots[1].ballot.choices[0].proof[0].c = tamperedBallot.ballots[0].ballot.choices[0].proof[0].c;
const badPartial = clone(transcript);
badPartial.partials[0].options[1].d = transport[0].key;
const nodeDisagrees = clone(transcript);
nodeDisagrees.report.counts = [9, 9, 9];
const anchored = clone(transcript);
anchored.state.anchor = { digest, network: "git", reference: "v1.0.0", anchored_at: 1761000004000 };
const wrongAnchor = clone(transcript);
wrongAnchor.state.anchor = { digest: "00".repeat(32), network: "git", reference: "v1.0.0", anchored_at: 1761000004000 };
const voting = clone(transcript);
voting.state.phase = "Voting";
voting.state.closure = null;
voting.partials = [];

const audits = Object.entries({
  honest: transcript,
  tampered_ballot: tamperedBallot,
  bad_partial: badPartial,
  node_disagrees: nodeDisagrees,
  anchored,
  wrong_anchor: wrongAnchor,
  voting,
}).map(([name, t]) => ({ name, transcript: t, audit: verifyTranscript(t) }));

const out = {
  generator: "apps/mero-vote/mobile/test-vectors/generate.mjs",
  source: "apps/mero-vote/app/src/crypto/{protocol,verify}.ts",
  protocol: P.PROTOCOL,
  base_multiples: multiples,
  point_decoding: decoding,
  scalar_decoding: scalarDecoding,
  scalar_arithmetic: arith,
  hashes: hashCases,
  rng: { seed: "mero-vote-mobile", first: rngFirst },
  lagrange: lagrangeSets,
  poll_id: pollId,
  trustees,
  threshold,
  transport,
  dealings: dealings.map(({ dealer, seed, dealing }) => ({ dealer, seed, dealing })),
  election_key: P.encodePoint(electionKey),
  shares,
  combined_secrets: combined.map(P.encodeScalar),
  verification_keys: trustees.map((_, j) => P.encodePoint(P.verificationKey(parsed, j + 1))),
  complaint: {
    recipient: trustees[0],
    dealer: trustees[2],
    index: 1,
    seed: complaintSeed,
    dealing: P.dealingToWire(cheat),
    secret: P.encodePoint(cSecret),
    proof: br(cProof),
  },
  rules,
  ballots: ballots.map(({ voter, seed, selection, ballot, digest }) => ({ voter, seed, selection, ballot, digest })),
  aggregate: agg.map((c) => ({ a: P.encodePoint(c.a), b: P.encodePoint(c.b) })),
  partials,
  counts,
  single_rules: single,
  single_ballots: singleBallots,
  transcript_digest: digest,
  audits,
};

writeFileSync(resolve(HERE, "vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${resolve(HERE, "vectors.json")}: counts ${JSON.stringify(counts)}, digest ${digest}`);
for (const a of audits) console.log(`  ${a.name}: verified=${a.audit.verified} agrees=${a.audit.agreesWithNode}`);
