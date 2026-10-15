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
// the launcher takes it. It is the one thing this app offers to share: no
// `calimero://` link, no raw code, and nowhere to paste either.
//
// Pure functions only — no DOM, no session. The capture side is
// `primeInvitationCapture` in `@calimero-network/mero-react`, primed in `main.tsx`.

import { createLink } from '@calimero-network/mero-platform';
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
