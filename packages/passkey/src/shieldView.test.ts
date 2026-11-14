import { describe, expect, it } from "vitest";
import { verifyNodeUrl, type NodeVerification, type NodeVerificationState } from "@calimero-network/mero-js";
import type { AppCodeCheck } from "@calimero-apps/connect";

import { checkedAgo, describeShield, shieldDetails, shieldKind, shortHash } from "./shieldView";

const URL_ = "https://node-3.relay.example.net";
const NOW = 1_700_000_000_000;

const verified = (over: Partial<NodeVerification> = {}): NodeVerificationState => ({
  status: "verified",
  url: URL_,
  mock: false,
  release: "2.3.148",
  profile: "locked-read-only",
  checkedAt: NOW - 120_000,
  ...over,
});
const bare = (over: Partial<NodeVerification> = {}): NodeVerificationState => {
  const { release: _release, profile: _profile, ...rest } = verified(over) as NodeVerification & { status: "verified" };
  return rest as NodeVerificationState;
};
const failed = (status: "refused" | "unreachable"): NodeVerificationState => ({
  status,
  url: URL_,
  reason: "the quote is for another key",
  checkedAt: NOW,
});
const match: AppCodeCheck = { status: "match", appHash: "7f3a00000000000000000000000000000000000000000000000000000000c91e", checkedAt: NOW };

const view = (state: NodeVerificationState, code: AppCodeCheck | null = null) =>
  describeShield(state, { cluster: "Calimero Cloud eu-shared-2", code, now: NOW });

describe("shieldKind", () => {
  it.each([
    ["sealed verified node", verified(), "verified"],
    ["mock quote, even with the locked profile", verified({ mock: true }), "unsealed"],
    ["debug profile", verified({ profile: "debug" }), "unsealed"],
    ["no profile", bare(), "unsealed"],
    ["refused", failed("refused"), "refused"],
    ["unreachable", failed("unreachable"), "checking"],
    ["still checking", { status: "checking", url: URL_ } as NodeVerificationState, "checking"],
  ])("%s -> %s", (_name, state, kind) => {
    expect(shieldKind(state)).toBe(kind);
  });
});

describe("describeShield", () => {
  it("the green node lists every verified fact and a verifier link", () => {
    const v = view(verified(), match);
    expect(v.label).toBe("Verified node");
    expect(v.title).toBe("You are talking to a genuine Calimero TEE node");
    expect(v.sub).toBe("Checked by this browser 2 minutes ago, before anything was sent.");
    expect(v.rows).toEqual([
      { label: "Cluster", value: "Calimero Cloud eu-shared-2" },
      { label: "Node", value: "node-3.relay.example.net", mono: true },
      { label: "Software", value: "mero-tee v2.3.148 · locked-read-only" },
      { label: "App code", value: "7f3a…c91e", full: match.appHash, mono: true },
    ]);
    expect(v.checks).toEqual([
      "Running in an Intel TDX enclave (not debug)",
      "Measurements match the signed v2.3.148 release",
      "Your connection is encrypted to this enclave's key",
      "Node runs this app's exact code",
    ]);
    expect(v.verifyUrl).toBe(verifyNodeUrl(URL_, "2.3.148"));
  });

  it("claims only what is backed: no app check, no app code row or check", () => {
    for (const code of [null, { status: "unknown", reason: "no" } as AppCodeCheck]) {
      const v = view(verified(), code);
      expect(v.rows.map((r) => r.label)).toEqual(["Cluster", "Node", "Software"]);
      expect(v.checks).not.toContain("Node runs this app's exact code");
    }
  });

  it("a mismatch is a red line and never a check", () => {
    const v = view(verified(), { status: "mismatch", appHash: "ab".repeat(32), expected: "cd".repeat(32) });
    const row = v.rows.find((r) => r.label === "App code");
    expect(row).toMatchObject({ tone: "bad", value: "Does not match this app's release (node runs abab…abab)" });
    expect(v.checks).not.toContain("Node runs this app's exact code");
  });

  it("a mock is a grey test server: no enclave claims, no verifier link", () => {
    const v = view(verified({ mock: true, release: undefined, profile: undefined }), match);
    expect(v.kind).toBe("unsealed");
    expect(v.label).toBe("Test server: not sealed");
    expect(v.sub).toMatch(/test server with no hardware enclave.*not sealed/);
    expect(v.checks).toEqual(["Node runs this app's exact code"]);
    expect(v.rows.map((r) => r.label)).toEqual(["Cluster", "Node", "App code"]);
    expect(v.verifyUrl).toBeNull();
  });

  it("a mock never links the verifier, even with a release named", () => {
    expect(view(verified({ mock: true })).verifyUrl).toBeNull();
  });

  it("a real node outside the sealed profile is grey, shows its profile, and still links the verifier", () => {
    const v = view(verified({ profile: "debug" }));
    expect(v.kind).toBe("unsealed");
    expect(v.rows.find((r) => r.label === "Software")?.value).toBe("mero-tee v2.3.148 · debug");
    expect(v.checks).not.toContain("Running in an Intel TDX enclave (not debug)");
    expect(v.checks).toContain("Measurements match the signed v2.3.148 release");
    expect(v.verifyUrl).toBe(verifyNodeUrl(URL_, "2.3.148"));
  });

  it("no release means no software row, no measurements check, no link", () => {
    const v = view(bare());
    expect(v.rows.map((r) => r.label)).toEqual(["Cluster", "Node"]);
    expect(v.checks).toEqual(["Your connection is encrypted to this enclave's key"]);
    expect(v.verifyUrl).toBeNull();
  });

  it("a refused node says nothing was sent and why", () => {
    const v = view(failed("refused"));
    expect(v.kind).toBe("refused");
    expect(v.sub).toBe("This app refused the node and sent nothing.");
    expect(v.rows.find((r) => r.label === "Reason")).toMatchObject({ value: "the quote is for another key", tone: "bad" });
    expect(v.checks).toEqual([]);
    expect(v.verifyUrl).toBeNull();
  });

  it("an unreachable node reads as checking, with the reason", () => {
    const v = view(failed("unreachable"));
    expect(v.label).toBe("Checking node…");
    expect(v.sub).toBe("The node could not be reached. Trying again.");
    expect(v.rows.find((r) => r.label === "Reason")?.value).toBe("the quote is for another key");
  });

  it("copies the facts shown, with the full hash", () => {
    const text = shieldDetails(view(verified(), match));
    expect(text).toContain("Node: node-3.relay.example.net");
    expect(text).toContain(`App code: ${match.appHash}`);
    expect(text).toContain("- Measurements match the signed v2.3.148 release");
    expect(text.startsWith("You are talking to a genuine Calimero TEE node")).toBe(true);
  });
});

describe("helpers", () => {
  it("says when, in plain words", () => {
    expect(checkedAgo(NOW - 3_000, NOW)).toBe("just now");
    expect(checkedAgo(NOW - 30_000, NOW)).toBe("30 seconds ago");
    expect(checkedAgo(NOW - 61_000, NOW)).toBe("1 minute ago");
    expect(checkedAgo(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago");
    expect(checkedAgo(NOW + 5_000, NOW)).toBe("just now");
  });

  it("shortens a hash to its ends", () => {
    expect(shortHash("7f3a".padEnd(60, "0") + "c91e")).toBe("7f3a…c91e");
    expect(shortHash("abc")).toBe("abc");
  });
});
