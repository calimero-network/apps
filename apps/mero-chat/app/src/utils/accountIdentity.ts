// The signed-in account, the one identity a person has on Calimero 1.0.
//
// v1 had a node account (hex), its base58 spelling, device keys and a member
// key per context, and compared them across encodings. A 1.0 account id is an
// opaque string (base64url of 32 random bytes) and is the caller everywhere:
// in every org, every app instance, every message's `sender`. So the helpers
// below compare and pass ids through as they are; the names stay because the
// screens call them.
import { getAccountId } from "../api/calimero";
import { registerAccountIdentity } from "./selfIdentity";

/** The account id (v1: its hex form). */
export function getSelfAccountHex(): string {
  return getAccountId();
}

/** The account id (v1: its base58 form). */
export function getSelfAccountBase58(): string {
  return getAccountId();
}

export function clearSelfAccount(): void {
  /* the session owns the account */
}

/** Registers the account as one of "my" identities and answers it. */
export async function loadSelfAccountIdentity(_namespaceId?: string): Promise<string | null> {
  const account = getAccountId();
  if (!account) return null;
  registerAccountIdentity(account);
  return account;
}

/** An account id as the node spells it (unchanged). */
export function toAccountHex(id: string | null | undefined): string {
  return (id ?? "").trim();
}

export function toAccountBase58(id: string | null | undefined): string {
  return (id ?? "").trim();
}

/** Whether two ids name the same account. */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = (a ?? "").trim();
  return left.length > 0 && left === (b ?? "").trim();
}

/** `AbCd…WxYz`: a compact, still-distinguishable form for a label. */
export function shortAccount(account: string | undefined): string {
  const id = (account ?? "").trim();
  if (!id) return "unknown";
  return id.length >= 8 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id;
}
