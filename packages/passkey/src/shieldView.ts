/** What the review says about a node, from the check mero-js ran: only what that check verified. */
import { verifyNodeUrl, type NodeVerificationState } from "@calimero-network/mero-js";
import type { AppCodeCheck } from "@calimero-apps/connect";

/** The release profile that seals a node's data (read-only, no operator access). */
const SEALED_PROFILE = "locked-read-only";
const JUST_NOW_SECONDS = 10;
const AGO = [
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
] as const;
const ago = new Intl.RelativeTimeFormat("en");

export type ShieldKind = "checking" | "verified" | "unsealed" | "refused";

export interface ShieldView {
  kind: ShieldKind;
  title: string;
  sub: string;
  /** Facts the check verified for this node, and nothing else. */
  checks: string[];
  /** The public verifier's page for this node; `null` unless a signed release judged a real quote. */
  verifyUrl: string | null;
}

/** Sealed means the locked profile on a real quote; `unreachable` is no answer yet, so it reads as checking. */
export function shieldKind(state: NodeVerificationState): ShieldKind {
  if (state.status === "refused") return "refused";
  if (state.status !== "verified") return "checking";
  return !state.mock && state.profile === SEALED_PROFILE ? "verified" : "unsealed";
}

/** "2 minutes ago", or "just now" for the last few seconds. */
export function checkedAgo(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < JUST_NOW_SECONDS) return "just now";
  const [unit, size] = AGO.find(([, size]) => seconds >= size) ?? (["second", 1] as const);
  return ago.format(-Math.floor(seconds / size), unit);
}

/** `7f3a…c91e`. */
export function shortHash(hash: string): string {
  return hash.length > 12 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash;
}

export function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").host;
  } catch {
    return url ?? "";
  }
}

function releaseName(code: Extract<AppCodeCheck, { status: "match" }>): string | null {
  return code.package && code.version ? `${code.package} v${code.version}` : null;
}

function copy(state: NodeVerificationState, kind: ShieldKind, ago: string): Pick<ShieldView, "title" | "sub"> {
  switch (kind) {
    case "verified":
      return {
        title: "You are talking to a genuine Calimero TEE node",
        sub: `Checked by this browser ${ago}, before anything was sent.`,
      };
    case "unsealed":
      return {
        title: "Test server: not sealed",
        sub:
          state.status === "verified" && state.mock
            ? `A test server with no hardware enclave, so its data is not sealed. Checked by this browser ${ago}.`
            : `This node did not show it runs the sealed, read-only profile, so its data is not sealed. Checked by this browser ${ago}.`,
      };
    case "refused":
      return { title: "Node refused", sub: "This app refused the node and sent nothing." };
    case "checking":
      return {
        title: "Checking node…",
        sub:
          state.status === "unreachable"
            ? "The node could not be reached. Trying again."
            : "This browser is checking the node before anything is sent.",
      };
  }
}

/** What the review says about the node for `state`, with the app's code check. */
export function describeShield(state: NodeVerificationState, { code, now = Date.now() }: { code: AppCodeCheck | null; now?: number }): ShieldView {
  const kind = shieldKind(state);
  // A mock is never a real node: nothing about releases or app code is claimed for one.
  const real = state.status === "verified" && !state.mock ? state : null;
  const release = real?.release;

  const checks: string[] = [];
  if (kind === "verified") checks.push("Running in an Intel TDX enclave (not debug)");
  if (real && release) checks.push(`Measurements match the signed v${release} release`);
  if (real) checks.push("Your connection is encrypted to this enclave's key");
  if (real && code?.status === "match") {
    const named = releaseName(code);
    checks.push(named ? `Node runs the code listed for ${named}` : "Node runs the code bundle this app was built for");
  }

  const checkedMs = "checkedAt" in state ? state.checkedAt : now;
  return {
    kind,
    ...copy(state, kind, checkedAgo(checkedMs, now)),
    checks,
    verifyUrl: real && release ? verifyNodeUrl(real.url, release) : null,
  };
}
