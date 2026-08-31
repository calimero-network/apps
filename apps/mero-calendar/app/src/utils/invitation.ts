import { createLink, parseIntent } from "@calimero-network/mero-platform";
import bs58 from "bs58";
import { deflateSync, inflateSync } from "fflate";

// ── Invitation codec ─────────────────────────────────────────────────────────
//
// The payload is deflate-compressed and base58-encoded into one compact
// pasteable string — the same wire format mero-blocks, merraria, mero-stream and
// mero-chat use.
//
// Why compress: the signed invitation is JSON carrying three 32-byte arrays
// rendered as decimal numbers, which is enormously redundant. Plain base64url of
// it produced a ~930-character link; deflate first and the same invitation is
// ~540. A near-kilobyte URL survives a paste but wraps badly in a chat window
// and gets truncated in link previews, so it reads as broken even when it works.
//
// Decoding accepts every form this app has ever emitted, because links already
// shared have to keep working:
//
//   1. base58(deflate(JSON))  — what `encodeInvitation` produces now
//   2. base58(JSON)           — uncompressed base58
//   3. base64url(JSON)        — what this app produced before this change
//   4. raw JSON               — hand-assembled, and useful when debugging
//
// Pure functions, no session or network access.

const BASE58_ALPHABET =
  /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;

/** Compress + base58-encode a JSON string into the shareable form. */
export function encodeInvitation(raw: string): string {
  const bytes = new TextEncoder().encode(raw);
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode any form listed at the top of this file back to the JSON string.
 * Returns the input unchanged when nothing matches, so callers that then
 * `JSON.parse` fail in the same way they always did.
 */
export function decodeInvitation(encoded: string): string {
  const trimmed = encoded.trim();
  if (!trimmed) return trimmed;

  // Already JSON — nothing to decode.
  if (trimmed.startsWith("{")) return trimmed;

  // base58, compressed or not. Checked first: a base58 string can also be valid
  // base64url (the alphabets overlap), and only one of the two is right.
  if (BASE58_ALPHABET.test(trimmed)) {
    try {
      const bytes = bs58.decode(trimmed);
      try {
        return new TextDecoder().decode(inflateSync(bytes));
      } catch {
        // Uncompressed base58 — but only if it really decoded to JSON. The two
        // alphabets overlap, so a short string like "YQ" decodes as base58 to
        // arbitrary bytes; returning those would hand the caller mojibake and
        // hide a genuinely malformed invitation.
        const text = new TextDecoder().decode(bytes);
        if (text.trimStart().startsWith("{")) return text;
      }
    } catch {
      /* not base58 after all — fall through */
    }
  }

  // Legacy base64url(JSON), as this app emitted before the switch.
  try {
    const padded = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const bin = atob(pad ? padded + "=".repeat(4 - pad) : padded);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    // Only accept it if it actually decoded to JSON: base64-decoding an
    // arbitrary string succeeds and returns mojibake, which would otherwise
    // mask a genuinely malformed invitation.
    if (text.trimStart().startsWith("{")) return text;
  } catch {
    /* not base64url either */
  }

  return trimmed;
}

/** Encode an invitation *object* as a shareable token. */
export function encodeInvitationObject(obj: unknown): string {
  return encodeInvitation(JSON.stringify(obj));
}

/** Decode a token produced by {@link encodeInvitationObject} back to its object. */
export function decodeInvitationObject<T = Record<string, unknown>>(
  encoded: string,
): T {
  return JSON.parse(decodeInvitation(encoded)) as T;
}

/**
 * The app's deep-link slug. The desktop resolves a link by
 * `Application.package`, and links.calimero.network resolves the web build by
 * asking the registry for that same package — so the slug IS the package id.
 * Keep equal to `slug`/`package` in `logic/Cargo.toml`.
 */
export const APP_SLUG = "com.calimero.merocalendar";

/** The intent action an invitation link carries. */
export const JOIN_ACTION = "join";

/** Query parameter carrying the invitation payload. */
export const INVITATION_PARAM = "invitation";

/**
 * The shareable form of an invitation token: a canonical HTTPS link that opens
 * the desktop app where it is installed and the published web build otherwise.
 *
 * Previously the invite modal copied the bare token, which put the burden of
 * knowing what to do with it on the recipient. {@link invitationTokenFrom}
 * reads a link back, and still accepts a bare token so links already shared
 * keep working.
 */
export function invitationLink(token: string): string {
  return createLink(APP_SLUG, JOIN_ACTION, { [INVITATION_PARAM]: token });
}

/** The token carried by an invitation link, or the input unchanged if it isn't one. */
export function invitationTokenFrom(input: string): string {
  const trimmed = input.trim();
  if (!/^(https?|calimero):\/\//i.test(trimmed)) return trimmed;
  try {
    return new URL(trimmed).searchParams.get(INVITATION_PARAM) ?? trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Pull an invitation token out of anything that might carry one: a platform
 * HTTPS link, a `calimero://` deep link, a bare query string, or the token
 * itself.
 *
 * Parsing goes through the SDK's `parseIntent` rather than `new URL()`, for one
 * specific reason: `calimero://<slug>/<action>` has to be split by hand,
 * because non-special-scheme host parsing mangles a dotted slug like
 * `com.calimero.merocalendar`.
 *
 * Returns null when there is no invitation in it — including a link carrying
 * some other app's slug, which is not ours to redeem.
 */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const intent = parseIntent(trimmed);

  // Reject another app's invitation — but only when this really is a platform
  // intent, meaning BOTH a slug and an action. `parseIntent` reports the first
  // path segment as the slug whatever it is, so this app's own routes
  // (`/teams?invitation=…`) come back as `{slug: "teams", action: null}` — a
  // route misread as a slug, which it has no way to know. Rejecting on the slug
  // alone would throw away our own links.
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
 * The current URL with `?invitation=` removed, for tidying the address bar after
 * the intent has been captured. Returns the input unchanged when there is
 * nothing to strip or it cannot be parsed.
 */
export function urlWithoutInvitation(href: string): string {
  try {
    const url = new URL(href);
    if (!url.searchParams.has(INVITATION_PARAM)) return href;
    url.searchParams.delete(INVITATION_PARAM);
    return url.pathname + (url.search ? url.search : "") + url.hash;
  } catch {
    return href;
  }
}
