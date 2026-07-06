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
 *     We only pre-seed `node_url` / `application_id` for a TOKEN-LESS cold open
 *     (which mero-react's callback parser ignores), so the connect screen is
 *     pre-filled.
 *  2. Web invitation capture: a shared link is `?invitation=<encoded>`. We stash
 *     it (the join flow consumes it after auth) and strip it from the URL.
 *
 * Both are best-effort and never throw into the render path.
 */
import { setNodeUrl, setApplicationId } from '@calimero-network/mero-react';

const INVITATION_KEY = 'pending-invitation';

/** True when running inside the Calimero desktop (Tauri) shell. */
export const IS_DESKTOP =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Run the SSO + invitation bootstrap. Call once, before ReactDOM.render. */
export function bootstrapSsoAndInvitation(): void {
  if (typeof window === 'undefined') return;
  try { persistAuthHash(); } catch { /* never block boot on a bad hash */ }
  try { captureInvitation(); } catch { /* never block boot on a bad query */ }
}

/**
 * Pre-seed node_url / application_id from a TOKEN-LESS hash (cold desktop open).
 *
 * A hash containing `access_token` is an auth callback owned by mero-react's
 * MeroProvider (parseAuthCallback) — used by both desktop SSO and web login.
 * We bail on it untouched so React can store the token where mero-js reads it
 * and strip the hash itself. See the file header for why touching it breaks auth.
 */
function persistAuthHash(): void {
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return;

  const p = new URLSearchParams(hash);

  // Token-bearing hash → it's an auth callback. Leave it entirely to mero-react.
  if (p.get('access_token')) return;

  // No token: only node URL / app id may be present (cold desktop open).
  // mero-react ignores a token-less callback, so seed these for the connect
  // screen. These ARE the correct keys (node_url / application_id are stored
  // separately from the token blob).
  const nodeUrl = p.get('node_url')?.trim();
  const applicationId = (p.get('application_id') ?? p.get('app-id') ?? '').trim();
  if (nodeUrl) setNodeUrl(nodeUrl);
  if (applicationId) setApplicationId(applicationId);
}

/** Web invitation: stash `?invitation=` for the join flow, then clean the URL. */
function captureInvitation(): void {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('invitation');
  if (!raw) return;
  localStorage.setItem(INVITATION_KEY, raw);
  params.delete('invitation');
  const qs = params.toString();
  window.history.replaceState(
    {}, '',
    window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
  );
}

/** Consume a captured invitation (returns it once, then clears it). */
export function takePendingInvitation(): string | null {
  const v = localStorage.getItem(INVITATION_KEY);
  if (v) localStorage.removeItem(INVITATION_KEY);
  return v;
}

/** Peek at a captured invitation without consuming it (e.g. to show a banner). */
export function peekPendingInvitation(): string | null {
  return localStorage.getItem(INVITATION_KEY);
}
