// The shareable form of an invite, built by the platform SDK.
//
// Kept OUT of inviteCodec.ts on purpose: the Playwright specs import the codec
// for fixtures and run under Node's raw ESM loader, which rejects the SDK's
// extensionless directory imports. Only bundled code (and vitest, which inlines
// the SDK) reaches this module.

import { createLink, parseIntent } from "@calimero-network/mero-platform";

/**
 * The app's deep-link slug. The desktop resolves a link by
 * `Application.package`, and links.calimero.network resolves the web build by
 * asking the registry for that same package — so the slug IS the package id.
 * Keep equal to `slug`/`package` in `logic/Cargo.toml`.
 */
export const APP_SLUG = "com.calimero.merraria";

/**
 * The shareable form of an invite code: a canonical HTTPS link that opens the
 * desktop app where it is installed and the published web build otherwise.
 * `decodeInvite` reads a pasted link back, so the raw code still works.
 */
export function inviteLink(code: string): string {
  return createLink(APP_SLUG, "join", { invitation: code });
}


/** The intent action an invite link carries. */
export const JOIN_ACTION = "join";

/** Query parameter carrying the invite code. */
export const INVITATION_PARAM = "invitation";

/**
 * Pull an invite code out of anything that might carry one: a platform HTTPS
 * link, a `calimero://` deep link, a bare query string, or the code itself.
 *
 * Parsing goes through the SDK's `parseIntent` rather than `new URL()`, for one
 * specific reason: `calimero://<slug>/<action>` has to be split by hand, because
 * non-special-scheme host parsing mangles a dotted slug like
 * `com.calimero.merraria`.
 *
 * Returns null when there is no invite in it — including a link carrying some
 * other app's slug, which is not ours to redeem.
 */
export function inviteFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const intent = parseIntent(trimmed);

  // Reject another app's invite — but only when this really is a platform
  // intent, meaning BOTH a slug and an action. `parseIntent` reports the first
  // path segment as the slug whatever it is, so a link into this app's own web
  // build comes back with a route misread as a slug, which it has no way to
  // know. Rejecting on the slug alone would throw away our own links.
  if (intent.slug && intent.action && intent.slug !== APP_SLUG) return null;

  const fromIntent = intent.params[INVITATION_PARAM];
  if (fromIntent) return fromIntent;

  if (/^(https?|calimero):\/\//i.test(trimmed)) {
    try {
      return new URL(trimmed).searchParams.get(INVITATION_PARAM);
    } catch {
      return null;
    }
  }
  return trimmed;
}

/**
 * The current URL with `?invitation=` removed, for tidying the address bar once
 * the intent has been captured. Returns the input unchanged when there is
 * nothing to strip or it cannot be parsed.
 */
export function urlWithoutInvite(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(INVITATION_PARAM)) return href;
    url.searchParams.delete(INVITATION_PARAM);
    return url.pathname + (url.search ? url.search : "") + url.hash;
  } catch {
    return href;
  }
}
