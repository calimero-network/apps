import { parseDeviceCredential } from "@calimero-network/mero-js";

// ── Who the contract thinks you are ──────────────────────────────────────────
//
// Two different questions hide behind "my identity", and only on a node login do
// they have the same answer:
//
//   EXECUTOR — what the session executes AS. It is what `identities-owned`
//   returns and what `useExecute` is handed. On a node it is the node's context
//   identity; on an account it is the ACCOUNT (the relay executes as the
//   account), and the account admin says so.
//
//   MY ID — what the CONTRACT records as the caller. `logic/src/lib.rs` keys
//   `members` by `caller()`, which is `env::device_id()`: deliberately the
//   DEVICE, because a stream is per-writer state (one person broadcasting from
//   a laptop and watching on a phone is two peers). Under delegation core builds
//   the principal from the warrant's `author_device_key` — the ed25519 signing
//   key the wallet certified for this device — so that, not the account, is
//   the `member_id` the roster shows and the `author` on every ephemeral frame.
//
// The executor is what writes go out as; `myId` is what to compare against
// `member.memberId` and `entry.author`. Mixing them up on an account marks
// nobody as "you", drops nobody's own frames, and claims a broadcast slot
// against yourself.

/**
 * The ed25519 signing key the wallet certified for this device, lowercase hex —
 * the account session's `myId`. Null when the credential is absent or will not
 * decode: a wrong answer here is worse than none, because a bad `myId` quietly
 * mislabels a roster instead of failing.
 */
export function deviceSigningKeyOf(
  credential: string | null | undefined,
): string | null {
  if (!credential) return null;
  try {
    const key = parseDeviceCredential(credential).signPublicKey;
    return key ? key.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * What the contract calls "you" in a room, for whichever way you are signed in.
 *
 * - node login: the identity this node holds in the context (`identities-owned`,
 *   the same thing it executes as);
 * - account: the certified device's signing key, from the delegated credential.
 *   `identity` is the ACCOUNT there and is deliberately NOT the answer.
 */
export function myIdFor(opts: {
  isDelegated: boolean;
  credential: string | null | undefined;
  identity: string | null | undefined;
}): string | null {
  if (opts.isDelegated) return deviceSigningKeyOf(opts.credential);
  return opts.identity ?? null;
}
