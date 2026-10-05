// ── Which streams nobody can be invited to (yet) ──────────────────────────────
//
// A namespace founded by an ACCOUNT (a delegated session) is founded through a
// relay, and the cloud is then asked to host it so that an invitee with no node
// of their own has a relay to be admitted through. The cloud refuses when it
// cannot place the founding account — the usual case is an account that has not
// been linked to a cloud user in the wallet. The namespace still exists and the
// founder can make rooms and call in them; what does not work is INVITING: the
// account admin refuses to mint a code nobody could claim.
//
// Two places learn about this — the create call (`haError`) and a later mint
// attempt (`InvitationNotClaimableError`) — and two pages show Invite buttons.
// The refusal is kept here, per namespace, so every Invite control can be gated
// on it and say why, instead of each click failing with the same message.
//
// Session-scoped on purpose: linking the account is done elsewhere and the
// state should not survive into a session where it may no longer be true.

/** What to tell a founder whose account the cloud cannot place. */
export const HOSTING_REFUSED_MESSAGE =
  "This stream is not hosted in the cloud yet, so nobody can be invited to it. Link this account to your cloud user in the wallet, then try again.";

const KEY = "mero-stream:unhosted";
const memory = new Map<string, string>();

function read(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function write(all: Record<string, string>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode / no storage: the in-memory map still carries the answer
    // for this page's life.
  }
}

/** Remember that `namespaceId` cannot be invited to, and why. */
export function markStreamUnhosted(namespaceId: string, reason: string): void {
  if (!namespaceId) return;
  memory.set(namespaceId, reason);
  const all = read();
  all[namespaceId] = reason;
  write(all);
}

/** Forget a refusal — hosting was granted, or a mint went through. */
export function clearStreamUnhosted(namespaceId: string): void {
  memory.delete(namespaceId);
  const all = read();
  if (namespaceId in all) {
    delete all[namespaceId];
    write(all);
  }
}

/** The reason `namespaceId` cannot be invited to, or null when it can. */
export function hostingProblem(namespaceId: string): string | null {
  if (!namespaceId) return null;
  return memory.get(namespaceId) ?? read()[namespaceId] ?? null;
}

/** Test seam. */
export function clearHostingState(): void {
  memory.clear();
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
