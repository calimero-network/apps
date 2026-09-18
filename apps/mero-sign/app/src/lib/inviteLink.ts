// ── Invitation LINKS ─────────────────────────────────────────────────────────
//
// What this replaced: `generateInvitationUrl` built
// `${window.location.origin}/?invitation=${encodeURIComponent(json)}`. Three
// things were wrong with it, and all three are why link invitations did not
// work in this app:
//
//   1. **It pointed at whatever origin happened to be serving the page.** Minted
//      inside the desktop shell, the "link" began `tauri://localhost` and was
//      useless to the recipient. Minted on a preview deployment, it pinned the
//      invitee to that preview.
//   2. **It carried the raw JSON, percent-escaped** — about 1,200 characters,
//      which chat clients wrap and mail clients truncate mid-signature.
//   3. **It only ever opened the web app.** A recipient with the desktop
//      installed had no way to be handed off to it.
//
// Links are now built by the platform SDK (`@calimero-network/mero-platform`),
// the same way mero-chat-pwa and mero-stream build them, which is the point —
// one ecosystem convention rather than one app's idea:
//
//   https://links.calimero.network/com.calimero.mero-sign/join?invitation=<code>
//
// The SDK is HTTPS-ONLY by design. An HTTPS link works everywhere: it opens the
// web app directly, and on a device with the desktop installed and associated
// the launcher takes it. `calimero://` is a device-local transport, not
// something to paste into a chat window — it is offered separately, as a
// secondary "copy desktop link" affordance.
//
// Pure functions only — no DOM, no session. See `lib/invitationIntents.ts` for
// the capture side, which does touch the platform.

import { createLink, parseIntent } from '@calimero-network/mero-platform';
import { PACKAGE_NAME } from '../constants/config';

/**
 * This app's slug, which IS its package id.
 *
 * Not a friendly name: the desktop launcher resolves a deep link by
 * `Application.package`, so the two must be the same string. It is declared in
 * `logic/Cargo.toml` under `[package.metadata.calimero]` (`package` and `slug`,
 * deliberately identical) and reaches the frontend as `PACKAGE_NAME` — the same
 * constant `<CalimeroProvider>` logs in with, so a link and a login can never
 * disagree about which app this is.
 *
 * ⚠️ Changing the package id in the manifest without changing `PACKAGE_NAME`
 * produces links that resolve to nothing, with no error anywhere.
 */
export const APP_SLUG = PACKAGE_NAME;

/** The intent verb. `join` is the ecosystem convention. */
export const JOIN_ACTION = 'join';

/** Query parameter carrying the invitation payload. */
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
 * link, a `calimero://` deep link, this app's older `?invitation=<json>` link, a
 * bare query string, or the code (or raw JSON) itself.
 *
 * Parsing goes through the SDK's `parseIntent`, which matters for one specific
 * reason: `calimero://<slug>/<action>` is split by hand there rather than with
 * `new URL().hostname`, because non-special-scheme host parsing mangles a dotted
 * slug like `com.calimero.mero-sign`.
 *
 * Returns null when there is no invitation in it — including for a URL carrying
 * another app's slug, which is not ours to redeem.
 */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const intent = parseIntent(trimmed);

  // Reject another app's invitation — but only when this really is a platform
  // intent, which means BOTH a slug and an action. `parseIntent` reports the
  // first path segment as the slug whatever it is, so this app's own older link
  // (`https://mero-sign.vercel.app/?invitation=…`) comes back as
  // `{slug: null, action: null}` with the params intact, and a link to some
  // deeper route would come back with a route misread as a slug. Rejecting on
  // the slug alone would throw away exactly the legacy links this function
  // exists to keep working.
  const isPlatformIntent = intent.slug !== null && intent.action !== null;
  if (isPlatformIntent && intent.slug !== APP_SLUG) return null;

  const value = intent.params[INVITATION_PARAM];
  if (value && value.trim()) return value.trim();

  // Not a URL at all — the code itself, or JSON pasted from the admin API.
  // `parseIntent` returns no params for those, and handing the raw string back
  // is what lets one "paste what you were sent" field accept every form.
  if (trimmed.startsWith('{')) return trimmed;
  if (/^[A-Za-z0-9]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Strip the invitation parameter from a URL, preserving everything else.
 *
 * The platform store is what makes redemption durable, so this is not how the
 * intent is remembered — it is hygiene. An invitation is a signed capability,
 * and one sitting in the address bar gets screenshotted, pasted into a bug
 * report, or shared by someone presenting their screen.
 *
 * ⚠️ The hash is PRESERVED. The previous implementation called
 * `history.replaceState({}, title, window.location.pathname)`, which drops both
 * the query and the fragment — and the fragment is where the desktop hand-off
 * carries the SSO session. Accepting an invitation would sign you out.
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
 * Always a link: the platform host is a constant, so unlike the old
 * origin-derived version there is no environment in which a link cannot be
 * built — the desktop shell included, which is exactly where the old code
 * produced a `tauri://` URL nobody else could open. The raw code stays
 * available as a disclosure, for pasting into another mero app.
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
