/**
 * Which application is this session actually bound to — and therefore which
 * namespaces and contexts belong to it.
 *
 * WHY THIS EXISTS
 *
 * Every list this app renders came straight from the node: `listContexts()` and
 * `listNamespaces()` are node-wide, and a node routinely hosts several
 * applications. So the context dropdown offered other apps' contexts, the
 * namespace pickers offered other apps' namespaces, and — the part that actually
 * broke things — the auto-selector fell through to `all[0]`.
 *
 * That fall-through was silent and total. With kv-store also installed on the
 * node, this app adopted a KV-STORE context on login and then ran its whole test
 * suite against a contract exporting 11 methods instead of 130. The result was
 * 12 passed / 110 failed, with every failure reported as a contract error rather
 * than as "you are pointed at the wrong app" — which is the only useful thing to
 * say.
 *
 * ⚠️ The root cause was reading the id from `import.meta.env.VITE_APP_ID`, a
 * BUILD-TIME variable. It is empty in every normal run (it exists to pin an
 * already-installed id during development), so `appId` was `undefined` and the
 * `?? all[0]` took over. The session already knows the answer: mero-react stores
 * the application id it authenticated with, and `getApplicationId()` returns it.
 * Env first (an explicit pin still wins), session second, and NEVER a positional
 * fallback.
 */
import { getApplicationId } from "@calimero-network/mero-react";

import type { ContextRecord, NamespaceRecord } from "./adminApi";

/**
 * This app's application id, or `undefined` if the session has none yet.
 *
 * `VITE_APP_ID` takes priority so a developer can still pin one; otherwise the
 * value comes from the live session rather than from the build.
 */
export function currentApplicationId(): string | undefined {
  const pinned = (import.meta.env.VITE_APP_ID as string | undefined)?.trim();
  if (pinned) return pinned;
  const fromSession = getApplicationId();
  return fromSession && fromSession.trim() ? fromSession.trim() : undefined;
}

/**
 * Contexts belonging to this application.
 *
 * Returns an EMPTY array when the app id is unknown, deliberately — not
 * everything. "I cannot tell which are mine" and "all of them are mine" are
 * different answers, and the second is what caused the wrong-context bug. An
 * empty list makes the UI say so instead of guessing.
 */
export function contextsForThisApp(all: ContextRecord[]): ContextRecord[] {
  const appId = currentApplicationId();
  if (!appId) return [];
  return all.filter((c) => c.applicationId === appId);
}

/** Namespaces targeting this application. Same empty-on-unknown rule. */
export function namespacesForThisApp(all: NamespaceRecord[]): NamespaceRecord[] {
  const appId = currentApplicationId();
  if (!appId) return [];
  return all.filter((n) => n.targetApplicationId === appId);
}
