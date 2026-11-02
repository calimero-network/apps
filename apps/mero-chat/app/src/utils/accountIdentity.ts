/**
 * The signed-in account, and comparing accounts.
 *
 * v1 had two spellings of one account (hex from the admin API, base58 from the
 * contract) and a per-context identity beside it, so every comparison went
 * through a canonicalisation. In 1.0 an account id is one string everywhere:
 * the session, the contract's `sender`, `identity`, reactions and mentions.
 * The helpers keep their names so the screens read as before.
 */
import { selfAccount } from "../calimero/connection";

export function getSelfAccountHex(): string {
  return selfAccount();
}

export function getSelfAccountBase58(): string {
  return selfAccount();
}

/** The account id itself: there is one spelling. */
export function toAccountHex(id: string | null | undefined): string {
  return (id ?? "").trim();
}

export function toAccountBase58(id: string | null | undefined): string {
  return (id ?? "").trim();
}

/** Whether two ids name the same account. Empty ids never match. */
export function sameAccount(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = toAccountHex(a);
  return left.length > 0 && left === toAccountHex(b);
}

/** A short stand-in for an account with no name yet. */
export function shortAccount(account: string | undefined): string {
  const id = (account ?? "").trim();
  if (!id) return "unknown";
  return id.length >= 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
