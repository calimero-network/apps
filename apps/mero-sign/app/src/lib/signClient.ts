// ── The typed contract client ───────────────────────────────────────────────
//
// ⚠️ WHAT THIS REPLACES, AND WHY IT MATTERS.
//
// Every other app in this repo talks to its contract through a client
// GENERATED from the ABI — mero-pass has `generated/MeroPassClient`,
// mero-forum has `generated/ForumClient`, both produced by
// `@calimero-network/abi-codegen` and wired up in `lib/vault.ts` /
// `lib/groups.ts`. Mero Sign did not. It had 1,548 lines of hand-written RPC
// in `api/dataSource/ClientApiDataSource.ts`, where every call was
//
//     try { if (this.app) … } catch { console.warn(…); /* fall back */ }
//
// and the fallback could not succeed. Every mero-sign defect found today came
// out of that shape rather than out of the protocol:
//
//   * the whole private-context surface passed a context RECORD where a
//     context ID belongs, and the node's `ParseError: invalid type: map,
//     expected a hex encoded hash` was swallowed by the catch
//   * blob ids were base58 where the node wants hex, and the failure landed in
//     `catch { /* a signature with no image still lists */ }`
//   * `createContext`'s real error was replaced by a fallback message naming
//     this repo's own source files
//
// A generated client cannot do any of that. The method names, the argument
// shapes and the return types come from `logic/res/abi.json`, so a contract
// change that this app has not followed is a TYPE ERROR rather than a 400 at
// runtime — and it throws, so nothing can quietly continue.
//
// ⚠️ `pnpm codegen` REGENERATES IT. Do not edit `generated/MeroSignClient.ts`.

import { MeroSignClient } from '../generated/MeroSignClient';
import { adminApi, meroInstance } from './node';

/**
 * A typed client for one context.
 *
 * ⚠️ Returns null when this node holds NO identity in that context, rather
 * than a client whose every call will be refused as an unauthorized signer.
 * The identity is the one this node OWNS there — not its account id. Both are
 * 64 hex since rc.27, so passing the wrong one type-checks, sends, and is
 * rejected as a signer problem rather than as a bad argument.
 */
export async function clientForContext(
  contextId: string,
): Promise<MeroSignClient | null> {
  if (!contextId) return null;
  const { identities } = await adminApi()
    .getContextIdentitiesOwned(contextId)
    .catch(() => ({ identities: [] as string[] }));
  if (identities.length === 0) return null;
  return new MeroSignClient(meroInstance(), contextId);
}

/**
 * A typed client for a context this node is known to be in.
 *
 * Skips the identity read — for a caller that has just created or entered the
 * context and would only be asking the node to confirm what it just did.
 */
export function clientFor(contextId: string): MeroSignClient {
  return new MeroSignClient(meroInstance(), contextId);
}
