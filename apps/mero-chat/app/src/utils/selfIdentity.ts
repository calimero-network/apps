import { selfAccount } from "../calimero/connection";

/**
 * Was `sender` the signed-in account? v1 checked every identity this node held
 * in the context (an account and per-context keys); in 1.0 the contract's
 * `sender` is the account that called. The extra arguments are accepted for
 * the callers' sake and ignored.
 */
export function isSelfSender(
  sender: string | null | undefined,
  _contextId?: string,
  ..._hints: (string | null | undefined)[]
): boolean {
  return !!sender && sender === selfAccount();
}
