// Token-bundle helpers for the Tauri desktop SSO-hash seeding in index.tsx.
//
// mero-js stores auth as a single JSON blob at `mero-tokens` (its
// LocalStorageTokenStore); MeroProvider reads and rotates that same blob.

export const TOKENS_KEY = "mero-tokens";

export type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

/**
 * Expiry straight from the access token's `exp` claim (seconds → ms).
 *
 * This is the same source mero-react uses (`parseJwtExpiry`), so a stored bundle
 * and a hash bundle are always compared on the same scale. Returns null for a
 * token that isn't a decodable JWT.
 */
export function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { exp?: number };
    return typeof claims.exp === "number" ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function readStoredTokens(): StoredTokens | null {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredTokens>;
    if (!p?.access_token || !p?.refresh_token) return null;
    return {
      access_token: p.access_token,
      refresh_token: p.refresh_token,
      expires_at: typeof p.expires_at === "number" ? p.expires_at : 0,
    };
  } catch {
    return null;
  }
}

/** Prefer the JWT's own `exp`; fall back to the recorded `expires_at`. */
export function tokenExpiryMs(tokens: StoredTokens): number {
  return jwtExpiryMs(tokens.access_token) ?? tokens.expires_at;
}

/**
 * Should the bundle carried in the SSO hash replace what's already stored?
 *
 * Refresh tokens are SINGLE-USE (core#3083): every `/auth/refresh` consumes the
 * presented refresh token and mints a new one. The desktop re-opens this app
 * with the bundle it minted at *its* login, so the hash routinely carries a
 * bundle OLDER than the stored one — mero-js may have rotated several times
 * since. Overwriting the store with the hash would re-present an already
 * consumed refresh token on the next 401, which the server treats as theft:
 * 401 `x-auth-error: token_reuse` → the whole token family is revoked → every
 * holder is hard-logged-out.
 *
 * So the stored bundle wins unless it can't be trusted: nothing stored, a
 * different node (foreign token family), or a genuinely newer hash bundle
 * (a fresh login).
 */
export function shouldSeedTokens(args: {
  hashExpiresAtMs: number;
  stored: StoredTokens | null;
  nodeChanged: boolean;
}): boolean {
  const { hashExpiresAtMs, stored, nodeChanged } = args;
  if (!stored) return true;
  if (nodeChanged) return true;
  return hashExpiresAtMs > tokenExpiryMs(stored);
}
