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
// associated, the launcher takes it. It is the one thing this app offers to
// share: no `calimero://` link, no raw code, and nowhere to paste either — an
// invitation reaches the app only by its link being opened.
//
// The `<code>` is the base58(deflate(JSON)) payload from `lib/inviteCodec`.
//
// ── Why a QUERY parameter and not the hash ───────────────────────────────────
//
// The hash belongs to SSO: the desktop hand-off puts the session tokens there,
// and mero-react reads them on boot. An invitation in the fragment would have to
// coexist with that, and stripping the fragment after reading — which an
// invitation MUST do, since it is a signed capability that should not sit in the
// address bar — would sign the user out to accept an invitation.
//
// Pure functions only — no DOM, no session. The capture side is
// `primeInvitationCapture` in `@calimero-network/mero-react`, primed in `index.tsx`.

import { createLink } from '@calimero-network/mero-platform';

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
 * Strip the invitation parameter from a URL, preserving everything else.
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
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ''}${hash}`;
}
