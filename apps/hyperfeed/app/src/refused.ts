/**
 * Why the node refused a call, in words a person can act on.
 *
 * Opened from Calimero Desktop, Hyperfeed acts with full access, as the admin
 * dashboard does. Signed in from a browser it holds an app's grant set, which
 * on purpose may not install apps or delete a feed: the node answers those
 * with a bare 403, which reached you as "HTTP 403 Forbidden".
 */
export function refusalMessage(e: unknown, doing: string): string {
  const err = e as { status?: unknown; name?: unknown; message?: unknown } | null;
  // A revoked login is also a 403, and means signing in again, not this.
  if (err?.status === 403 && err.name !== "AuthRevokedError") {
    return `This session may not ${doing}. Open Hyperfeed from Calimero Desktop, which lets it.`;
  }
  return e instanceof Error ? e.message : String(e);
}
