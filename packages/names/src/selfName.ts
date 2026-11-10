// Your name in an organization: asked once, when you create the organization
// or join it, and used by every project, board, document and calendar in it.
//
// The org's member metadata `{ name }` is the one record of it. An app reads it
// when a project opens and copies it into that project's own roster (a
// contract `join`, `setUsername`, …) without asking. The only place a name is
// ever asked for is creating or joining an org — or, for an org made before
// this, the first time you open anything in it, once.

const LAST_KEY = "calimero-names:last";

/** The name this browser last used for itself in any org of this app, or "". */
export function lastUsedName(storage: Storage | null | undefined = safeLocalStorage()): string {
  try {
    return storage?.getItem(LAST_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

/** Remember `name` as the one to offer when the next org asks. */
export function rememberLastUsedName(name: string, storage: Storage | null | undefined = safeLocalStorage()): void {
  const clean = name.trim();
  if (!clean) return;
  try {
    storage?.setItem(LAST_KEY, clean);
  } catch {
    /* private mode / quota: the org record still holds it */
  }
}

/** Forget the remembered name, e.g. on sign-out, so the next person is not offered it. */
export function forgetLastUsedName(storage: Storage | null | undefined = safeLocalStorage()): void {
  try {
    storage?.removeItem(LAST_KEY);
  } catch {
    /* nothing to forget */
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The slice of mero-js's `CalimeroClient` that writes your name to an org. */
export interface OrgNameClient {
  setMemberMetadata(org: string, account: string, metadata: Record<string, unknown>): Promise<unknown>;
  // Loose on purpose: mero-js's `OrgInfo` does not declare `memberMetadata`.
  getOrg?(org: string): Promise<unknown>;
}

/** `account`'s name in an org's `memberMetadata` map, or "". */
export function orgMemberName(
  memberMetadata: Record<string, unknown> | null | undefined,
  account: string | null | undefined,
): string {
  if (!memberMetadata || !account) return "";
  const meta = memberMetadata[account];
  if (meta && typeof meta === "object" && typeof (meta as { name?: unknown }).name === "string") {
    return ((meta as { name: string }).name || "").trim();
  }
  return "";
}

/**
 * Show `account` as `name` in `org`. Keeps whatever else the member record
 * holds (core replaces it whole), and remembers the name for the next org.
 * Throws when the node refuses.
 */
export async function setOrgName(client: OrgNameClient, org: string, account: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean || !org || !account) return;
  let current: Record<string, unknown> = {};
  if (client.getOrg) {
    const o = (await client.getOrg(org).catch(() => null)) as { memberMetadata?: Record<string, unknown> | null } | null;
    const meta = o?.memberMetadata?.[account];
    if (meta && typeof meta === "object") current = meta as Record<string, unknown>;
  }
  await client.setMemberMetadata(org, account, { ...current, name: clean });
  rememberLastUsedName(clean);
}

export type SelfNameDecision =
  /** The org's names have not loaded: do nothing yet (asking now re-asks people who have one). */
  | { kind: "wait" }
  /** You have a name in the org: use it (copy it into the project's roster if it is not there). */
  | { kind: "use"; name: string }
  /** No name in the org, but one from elsewhere (the project's roster, an older key): publish it to the org, no prompt. */
  | { kind: "adopt"; name: string }
  /** No name anywhere: ask once, for the org. */
  | { kind: "ask"; suggestion: string };

/**
 * What to do about your name when something inside an org opens. Never asks
 * when the org already has a name for you; a name the project or an older
 * per-app key already holds is adopted into the org instead of asked again.
 */
export function decideSelfName(input: {
  orgReady: boolean;
  orgName: string | null | undefined;
  /** Names known from before this org name existed: the project's roster, an app's old key. */
  fallbacks?: Array<string | null | undefined>;
}): SelfNameDecision {
  const orgName = (input.orgName ?? "").trim();
  if (orgName) return { kind: "use", name: orgName };
  if (!input.orgReady) return { kind: "wait" };
  const known = (input.fallbacks ?? []).map((n) => (n ?? "").trim()).find(Boolean);
  if (known) return { kind: "adopt", name: known };
  return { kind: "ask", suggestion: lastUsedName() };
}
