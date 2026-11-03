/**
 * The account's private signature library: one app instance it owns outside
 * any workspace, set up as `setup(true, "default")` (v1's "default private
 * context"). Found by name among the instances the account reaches, created on
 * first use, and remembered per account for the rest of the page's life.
 */
import { ensurePrivateLibrary } from '../lib/agreements';
import { signSession } from '../lib/node';

let cached: { accountId: string; appId: string } | null = null;
let inflight: { accountId: string; promise: Promise<string> } | null = null;

/**
 * The library's instance id, creating it if this account has none yet.
 * `_app` is the signed-in session the caller holds (it re-runs on a new one).
 */
export async function defaultContextIdFor(_app?: unknown): Promise<string> {
  const s = signSession();
  if (cached?.accountId === s.accountId) return cached.appId;
  if (inflight?.accountId !== s.accountId) {
    const promise = ensurePrivateLibrary(
      s.client,
      s.source,
      s.accountId,
      s.after,
    ).then(
      (appId) => {
        cached = { accountId: s.accountId, appId };
        return appId;
      },
      (e) => {
        inflight = null;
        throw e;
      },
    );
    inflight = { accountId: s.accountId, promise };
  }
  return inflight!.promise;
}

/** Forgets the remembered library (sign-out). */
export function clearDefaultContext(): void {
  cached = null;
  inflight = null;
}
