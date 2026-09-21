// ── Invitation LINKS ─────────────────────────────────────────────────────────
//
// Mero Pass had no invitations at all: the vault list told the user to "ask
// whoever runs it for an invitation", and nothing in the app could mint one. So
// there is no legacy code format to keep working here — this is the ecosystem
// convention adopted whole, the way mero-stream, mero-meet and mero-chat-pwa
// build links:
//
//   https://links.calimero.network/com.calimero.mero-pass/join?invitation=<code>
//
// The `@calimero-network/mero-platform` SDK builds and parses them. It is
// HTTPS-ONLY by design, and that is the right default: an HTTPS link opens the
// web/PWA app directly, and on a device with the desktop app installed and
// associated, the launcher takes it. `calimero://` is a device-local transport
// rather than something to paste into a chat, so it is offered separately as a
// secondary "copy desktop link" affordance.
//
// ⚠️ THE INVITATION RIDES A QUERY PARAMETER, NEVER THE URL HASH. The hash
// belongs to the desktop SSO hand-off (`#node_url=…&access_token=…`), which
// `MeroProvider` parses and strips on first render — see `src/index.tsx`.
// Putting an invitation there would race the session out of the URL, and
// `urlWithoutInvitation` below preserves the hash for exactly that reason.
//
// ⚠️ AND IT CARRIES NO SECRET. The `<code>` is a signed grant of membership in
// a namespace plus a few unsigned routing hints — see `lib/inviteCodec`. A vault
// password never touches a link, a query string, a log line or localStorage.
//
// Pure functions only — no DOM, no session. See `lib/invitationIntents.ts` for
// the capture side, which does touch the platform.

import { createLink, parseIntent } from '@calimero-network/mero-platform';

/**
 * This app's slug, which IS its package id.
 *
 * Not a friendly name: the desktop launcher resolves a deep link by
 * `Application.package`, so the two must be the same string. It is declared once
 * in `logic/Cargo.toml` under `[package.metadata.calimero]` (`package` and
 * `slug`, deliberately identical) and mirrored here because the frontend cannot
 * read the manifest at build time.
 *
 * ⚠️ Changing the package id in the manifest without changing this produces
 * links that resolve to nothing, with no error anywhere.
 */
export const APP_SLUG = 'com.calimero.mero-pass';

/** The intent verb. `join` is the ecosystem convention; chat-pwa uses it too. */
export const JOIN_ACTION = 'join';

/** Query parameter carrying the invitation payload, matching chat-pwa. */
export const INVITATION_PARAM = 'invitation';

/**
 * Canonical shareable invitation link — HTTPS, via the platform SDK.
 *
 * `host` exists for tests and for pointing a dev build at a non-default link
 * host; production wants the default.
 */
export function invitationUrl(code: string, host?: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('cannot build an invitation link for an empty code');
  }
  return createLink(
    APP_SLUG,
    JOIN_ACTION,
    { [INVITATION_PARAM]: trimmed },
    host,
  );
}

/**
 * Device-local deep link, for the "copy desktop link" affordance.
 *
 * Kept out of the SDK's remit on purpose — it is HTTPS-only by design, because
 * `calimero://` is a transport between the launcher and an app rather than
 * something that survives being pasted into a chat window.
 */
export function invitationDeepLink(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error('cannot build a deep link for an empty code');
  }
  return `calimero://${APP_SLUG}/${JOIN_ACTION}?${INVITATION_PARAM}=${encodeURIComponent(trimmed)}`;
}

/**
 * Pull an invitation payload out of anything a person might hand us: a platform
 * link, a `calimero://` deep link, a bare query string, or the code itself.
 *
 * Parsing goes through the SDK's `parseIntent`, which matters for one specific
 * reason: `calimero://<slug>/<action>` is split by hand there rather than with
 * `new URL().hostname`, because non-special-scheme host parsing mangles a dotted
 * slug like `com.calimero.mero-pass`.
 *
 * Returns null when there is no invitation in it — including for a URL that
 * carries some other app's slug, which is not ours to redeem.
 */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const intent = parseIntent(trimmed);

  // Reject another app's invitation — but only when this really is a platform
  // intent, which means BOTH a slug and an action. `parseIntent` reports the
  // first path segment as the slug whatever it is, so this app's own
  // `/home?invitation=…` comes back as `{slug: "home", action: null}` — a route
  // misread as a slug, which it has no way to know. Rejecting on the slug alone
  // would therefore throw away the app's own links.
  const isPlatformIntent = intent.slug !== null && intent.action !== null;
  if (isPlatformIntent && intent.slug !== APP_SLUG) return null;

  const code = intent.params[INVITATION_PARAM]?.trim();
  if (code) return code;

  // ── Not a URL at all: the bare code ─────────────────────────────────────
  //
  // Until there was a "paste what you were sent" field this could not happen —
  // every invitation arrived as a link and every caller had a URL. It does now,
  // and a code pasted on its own has no params for `parseIntent` to find, so
  // without this the field rejects the exact string the invite dialog told the
  // sender to copy.
  //
  // The shape test is deliberately narrow. A code is base58 (see
  // `lib/inviteCodec`), so anything with a slash, a space or a `?` in it is a
  // URL we failed to parse rather than a code, and handing THAT to the decoder
  // turns "that link is not for this app" into "that invitation could not be
  // read".
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Strip the invitation parameter from a URL, preserving everything else.
 *
 * The platform store is what makes redemption durable, so this is not how the
 * intent is remembered — it is hygiene. An invitation is a signed capability,
 * and one sitting in the address bar of a PASSWORD MANAGER gets screenshotted,
 * pasted into a bug report, or shared by someone demoing their screen.
 *
 * The hash is preserved: it carries the SSO session on the desktop hand-off, and
 * dropping it would sign the user out to accept an invitation.
 */
export function urlWithoutInvitation(url: string): string {
  const [beforeHash, ...hashParts] = url.split('#');
  const hash = hashParts.length ? `#${hashParts.join('#')}` : '';
  const q = beforeHash.indexOf('?');
  if (q < 0) return url;

  const base = beforeHash.slice(0, q);
  const params = new URLSearchParams(beforeHash.slice(q + 1));
  params.delete(INVITATION_PARAM);
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ''}${hash}`;
}

/**
 * What to offer as the shareable thing.
 *
 * Always a link: the platform host is a constant, so unlike an origin-derived
 * version there is no environment in which a link cannot be built — the desktop
 * shell included, where `tauri://` is not an origin worth sharing. The raw code
 * remains available as a disclosure for cross-app pasting.
 */
export function shareableInvitation(code: string): {
  link: string;
  deepLink: string;
  code: string;
} {
  return {
    link: invitationUrl(code),
    deepLink: invitationDeepLink(code),
    code: code.trim(),
  };
}
