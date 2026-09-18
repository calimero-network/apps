// ── Invitation LINKS ─────────────────────────────────────────────────────────
//
// An invite used to be delivered as a bare base64 blob in a read-only textarea:
// copy ~400 characters, send them to someone, and have them find the "Join with
// invitation" button and paste them into a second textarea. Nothing about that
// is a link, so nothing about it works the way a person expects a shared thing
// to work — it cannot be clicked, it cannot open the app, and it carries no clue
// about what it is for.
//
// Links are built by the platform SDK (`@calimero-network/mero-platform`), the
// same way mero-chat-pwa and mero-stream build them, and that is the point — it
// is one ecosystem convention rather than one app's idea:
//
//   https://links.calimero.network/com.calimero.mero-sheets/join?invitation=<code>
//
// The SDK is HTTPS-ONLY by design. An HTTPS link works everywhere: it opens the
// web/PWA app directly, and on a device with the desktop app installed and
// associated, the launcher takes it. `calimero://` is a device-local transport,
// not something to paste into a chat — it is offered separately, as a secondary
// "copy desktop link" affordance.
//
// The `<code>` is the base58(deflate(JSON)) payload from `lib/inviteCodec`, so a
// link degrades to a code if someone strips the URL, and a code pasted from any
// other mero app still works.
//
// ── Why a QUERY parameter and not the hash ───────────────────────────────────
//
// The hash belongs to SSO: the desktop hand-off puts the session tokens there,
// and mero-react reads them on boot. An invitation in the fragment would have to
// coexist with that, and stripping the fragment after reading — which an
// invitation MUST do, since it is a signed capability that should not sit in the
// address bar — would sign the user out to accept an invitation.
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
 * `slug`, deliberately identical), mirrored in `studio.config.json`, and read
 * from there rather than retyped — a third copy is a third thing to drift.
 */
export { APP_PACKAGE as APP_SLUG } from '../config';
import { APP_PACKAGE as APP_SLUG } from '../config';

/** The intent verb. `join` is the ecosystem convention; chat-pwa uses it too. */
export const JOIN_ACTION = 'join';

/** Query parameter carrying the invitation payload, matching chat-pwa. */
export const INVITATION_PARAM = 'invitation';

/**
 * The parameter an older hand-rolled link might carry.
 *
 * Never written, still read. mero-sheets never shipped one, but the other apps
 * in this monorepo did, and a person who has both installed will sooner or later
 * paste one shape into the other's field.
 */
export const LEGACY_INVITE_PARAM = 'invite';

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
  return createLink(APP_SLUG, JOIN_ACTION, { [INVITATION_PARAM]: trimmed }, host);
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
 * link, a `calimero://` deep link, an older `?invite=` link, a bare query
 * string, or the code itself.
 *
 * Parsing goes through the SDK's `parseIntent`, which matters for one specific
 * reason: `calimero://<slug>/<action>` is split by hand there rather than with
 * `new URL().hostname`, because non-special-scheme host parsing mangles a dotted
 * slug like `com.calimero.mero-sheets`.
 *
 * Returns null when there is no invitation in it — including for a URL that
 * carries some other app's slug, which is not ours to redeem.
 */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const intent = parseIntent(trimmed);

  // Reject another app's invitation — but only when this really is a platform
  // intent, which means BOTH a slug and an action.
  //
  // `parseIntent` reports the first path segment as the slug whatever it is, so
  // this app's own URL (`/mero-sheets?invitation=…`) comes back as
  // `{slug: "mero-sheets", action: null}` — a route misread as a slug, which it
  // has no way to know. Rejecting on the slug alone would therefore throw away
  // exactly the links the launcher produces.
  const isPlatformIntent = intent.slug !== null && intent.action !== null;
  if (isPlatformIntent && intent.slug !== APP_SLUG) return null;

  const value =
    intent.params[INVITATION_PARAM] ?? intent.params[LEGACY_INVITE_PARAM];
  const code = value?.trim();
  return code ? code : null;
}

/**
 * Strip both invitation parameters from a URL, preserving everything else.
 *
 * The platform store is what makes redemption durable, so this is not how the
 * intent is remembered — it is hygiene. An invitation is a signed capability,
 * and one sitting in the address bar gets screenshotted, pasted into a bug
 * report, or shared by someone showing their screen.
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
  params.delete(LEGACY_INVITE_PARAM);
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ''}${hash}`;
}

/**
 * What to offer as the shareable thing.
 *
 * Always a link: the platform host is a constant, so unlike an origin-derived
 * link there is no environment in which one cannot be built — the desktop shell
 * included, where `tauri://` is not an origin worth sharing. The raw code
 * remains available behind a disclosure, for cross-app pasting.
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
