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

import { listApplications } from "./adminApi";
import type { ContextRecord, NamespaceRecord } from "./adminApi";

/**
 * The package this app is published under. Kept in sync with main.tsx's
 * DEFAULT_PACKAGE and with `logic/Cargo.toml`'s registry metadata; an override
 * exists for the same reason main.tsx has one.
 */
const PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.scaffolding-e2e";

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

/**
 * This app's id, asking the NODE when the session cannot say.
 *
 * `currentApplicationId()` answers from the build pin or the session, and
 * returns undefined when neither has it — which is correct, and was also the
 * whole of the Setup wizard's problem. With no id, the "Create Namespace"
 * button is disabled (`!isHexId(appId)`) and the namespace list filters to
 * empty, so the page reads as "this app will not let me create anything" with
 * nothing on screen explaining why.
 *
 * The node knows. It lists what is installed, and this app knows its own
 * package name, so the id is one request away. Resolution order is unchanged
 * where it already worked — pin, then session — with the node as a last resort
 * rather than a positional guess: matching on PACKAGE is exact, and no match
 * still returns undefined rather than `apps[0]`, which is the fallback that
 * once pointed this app at a kv-store context.
 */
export async function resolveApplicationId(): Promise<string | undefined> {
  const known = currentApplicationId();
  if (known) return known;
  const installed = await listApplications().catch(() => []);
  return installed.find((a) => a.package === PACKAGE)?.id;
}
