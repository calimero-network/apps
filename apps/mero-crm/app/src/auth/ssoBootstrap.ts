/**
 * SSO + invitation bootstrap — runs ONCE before React mounts (see index.tsx).
 *
 * Two jobs:
 *  1. Desktop cold-open pre-seed: when opened from the Calimero desktop (Tauri)
 *     app, the session arrives in the URL hash
 *     (#access_token=…&refresh_token=…&node_url=…&application_id=…).
 *
 *     IMPORTANT: a hash that carries `access_token` is an auth callback that
 *     mero-react owns. Its MeroProvider runs `parseAuthCallback(location.href)`
 *     on first render, which stores the token in the format mero-js actually
 *     reads (the `mero-tokens` JSON blob — NOT the `mero:access_token` keys),
 *     sets app/context/node, and strips the hash. The SAME hash format is used
 *     by the web login redirect. So we must NOT touch (and especially not strip)
 *     a token-bearing hash here — doing so races ahead of React and leaves the
 *     token in the wrong place, so every API call goes out unauthenticated (401)
 *     and the user is bounced back to the landing page.
 *
 *     We pre-seed `node_url` / `application_id` (stored separately from the
 *     token blob) for BOTH token-less and token-bearing hashes: token-less
 *     pre-fills the connect screen, and token-bearing needs node_url seeded
 *     so mero-react ≥4.2.0 trusts the callback's node (see persistAuthHash).
 *  2. Invitation capture: starting the platform deep-link controller (see
 *     `auth/invitationIntents`). This used to be a hand-rolled read of
 *     `location.search` right here; it now lives next to the link builder and
 *     covers the launcher's warm `deep-link` event, the PWA launch queue and
 *     `calimero://` links as well as the cold-open URL.
 *
 *     It still has to happen HERE, before React mounts: `App.tsx` redirects a
 *     signed-in visitor off `/` with `<Navigate replace>`, which rewrites the
 *     URL — query string and all — before any component below it mounts.
 *
 * Both are best-effort and never throw into the render path.
 */
import { setNodeUrl, setApplicationId } from '@calimero-network/mero-react';
import { primeInvitationCapture as ensureInvitationCapture } from "@calimero-apps/invite";

/** True when running inside the Calimero desktop (Tauri) shell. */
export const IS_DESKTOP =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Run the SSO + invitation bootstrap. Call once, before ReactDOM.render. */
export function bootstrapSsoAndInvitation(): void {
  if (typeof window === 'undefined') return;
  try { persistAuthHash(); } catch { /* never block boot on a bad hash */ }
  try { ensureInvitationCapture("mero-crm"); } catch { /* never block boot on a bad query */ }
}

/**
 * Pre-seed node_url / application_id from the hash (cold desktop open).
 *
 * A hash containing `access_token` is an auth callback owned by mero-react's
 * MeroProvider (parseAuthCallback) — used by both desktop SSO and web login.
 * We leave the TOKEN and the hash itself untouched so React can store the token
 * where mero-js reads it and strip the hash itself. See the file header for why
 * touching either breaks auth.
 *
 * The wording above is not incidental: this docstring still said "TOKEN-LESS"
 * and "we bail on it" long after the body stopped bailing, and the copy of this
 * file in mero-sheets — which still had the early return — read as if that were
 * the intended design.
 */
function persistAuthHash(): void {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const p = new URLSearchParams(hash);

  // Pre-seed node_url / application_id regardless of whether a token is
  // present. These are stored SEPARATELY from the token blob, so seeding
  // them never races the token handling below.
  //
  // Why this must happen for a token-bearing hash too (mero-react ≥4.2.0):
  // MeroProvider.parseAuthCallback now REJECTS an auth callback whose
  // node_url wasn't the one login was "initiated" with (getNodeUrl()) and
  // isn't in `allowedNodeUrls` — logging "OAuth callback node_url is not
  // trusted … no tokens stored". A desktop-SSO / e2e hash is a direct
  // callback with no prior initiation, so without this seed getNodeUrl() is
  // empty and every token-in-hash login silently fails. Seeding node_url
  // here makes `initiated` == the callback's node_url (same origin) → the
  // callback is trusted and the token is stored.
  const nodeUrl = p.get('node_url')?.trim();
  const applicationId = (p.get('application_id') ?? p.get('app-id') ?? '').trim();
  if (nodeUrl) setNodeUrl(nodeUrl);
  if (applicationId) setApplicationId(applicationId);

  // Token-bearing hash → it's an auth callback mero-react owns. We've seeded
  // node_url above; leave the TOKEN and the hash itself untouched so
  // parseAuthCallback stores the token where mero-js reads it and strips the
  // hash (see file header — touching the token/hash here breaks auth).
}
