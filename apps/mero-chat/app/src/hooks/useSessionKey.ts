import { useCalimero } from "../api/calimero";

/**
 * Which session the screens are showing, as a key that changes when it does:
 * `account:<id>` once signed in, `null` before. Lists keyed on it reload on a
 * new sign-in instead of showing the previous account's workspaces.
 */
export function useSessionKey(): string | null {
  const { accountId } = useCalimero();
  return accountId ? `account:${accountId}` : null;
}
