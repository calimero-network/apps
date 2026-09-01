// ── Invitation LINKS ─────────────────────────────────────────────────────────
//
// An invite used to be delivered as a bare base58 blob in a read-only input:
// copy ~380 characters, send them to someone, and have them find the "paste an
// invite code" field.
//
// Links are built by the platform SDK (`@calimero-network/mero-platform`), the
// same way mero-chat-pwa builds them, and that is the point — it is one
// ecosystem convention rather than one app's idea:
//
//   https://links.calimero.network/com.calimero.merostream/join?invitation=<code>
//
// The SDK is HTTPS-ONLY by design. An HTTPS link works everywhere: it opens the
// web/PWA app directly, and on a device with the desktop installed and
// associated, the launcher takes it. `calimero://` is a device-local transport,
// not something to paste into a chat — it is offered separately, as a secondary
// "copy desktop link" affordance, exactly as chat-pwa does.
//
// The `<code>` is unchanged: the same base58(deflate(JSON)) payload
// `lib/inviteCodec` already produced, which is also what chat-pwa's
// `encodeInvitationPayload` produces. So a code pasted from any mero app still
// works, and a link degrades to a code if someone strips the URL.
//
// ── What this replaced, and why the SDK version is better ────────────────────
//
// The first attempt hand-rolled `<origin><pathname>?invite=<code>`, which had
// two problems the SDK simply does not have:
//
//   1. **It pointed wherever the Invite button happened to be.** A room invite
//      minted on `/streams/:namespaceId` produced a link to that path, and the
//      redemption effect lived on `/streams` — so the recipient landed on a
//      namespace they had no access to and silently never joined. With the SDK,
//      the link addresses the APP by slug and an intent by verb; the app decides
//      where to handle it, once, from any landing route.
//   2. **It only ever saw `location.href` on one route, once.** The SDK's
//      `DeepLinkController` merges the cold-open URL, the launcher's warm
//      `deep-link` bridge event and the PWA `launchQueue`, funnels all three
//      through a durable store that survives reload and the auth redirect, dedups
//      by content nonce, replays to a handler that registers late, and only drops
//      an intent when the app acks it. All of that was either hand-written here
//      or, mostly, missing.
//
// Pure functions only — no DOM, no session. See `lib/invitationIntents.ts` for
// the capture side, which does touch the platform.

import { createLink, parseIntent } from "@calimero-network/mero-platform";

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
export const APP_SLUG = "com.calimero.merostream";

/** The intent verb. `join` is the ecosystem convention; chat-pwa uses it too. */
export const JOIN_ACTION = "join";

/** Query parameter carrying the invitation payload, matching chat-pwa. */
export const INVITATION_PARAM = "invitation";

/**
 * The `?invite=` parameter this app shipped before adopting the platform links.
 *
 * Still read on the way in, never written. Any link already sent to somebody
 * carries it, and silently breaking those would be a worse outcome than one
 * extra branch in a parser.
 */
export const LEGACY_INVITE_PARAM = "invite";

/**
 * Canonical shareable invitation link — HTTPS, via the platform SDK.
 *
 * `host` exists for tests and for pointing a dev build at a non-default link
 * host; production wants the default.
 */
export function invitationUrl(code: string, host?: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error("cannot build an invitation link for an empty code");
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
 * something that survives being pasted into a chat window. Offered as a
 * secondary action for the case where someone wants to hand the desktop app a
 * link directly.
 */
export function invitationDeepLink(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) {
    throw new Error("cannot build a deep link for an empty code");
  }
  return `calimero://${APP_SLUG}/${JOIN_ACTION}?${INVITATION_PARAM}=${encodeURIComponent(trimmed)}`;
}

/**
 * Pull an invitation payload out of anything a person might hand us: a platform
 * link, a `calimero://` deep link, this app's older `?invite=` link, a bare
 * query string, or the code itself.
 *
 * Parsing goes through the SDK's `parseIntent`, which matters for one specific
 * reason: `calimero://<slug>/<action>` is split by hand there rather than with
 * `new URL().hostname`, because non-special-scheme host parsing mangles a dotted
 * slug like `com.calimero.merostream`.
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
  // this app's own older link (`/streams?invite=…`) comes back as
  // `{slug: "streams", action: null}` — a route misread as a slug, which it has
  // no way to know. Rejecting on the slug alone therefore threw away exactly the
  // legacy links this function exists to keep working.
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
 * intent is remembered — it is hygiene. An invitation is a signed capability, and
 * one sitting in the address bar gets screenshotted, pasted into a bug report, or
 * shared by someone showing their screen.
 *
 * The hash is preserved: it carries the SSO session on the desktop hand-off, and
 * dropping it would sign the user out to accept an invitation.
 */
export function urlWithoutInvitation(url: string): string {
  const [beforeHash, ...hashParts] = url.split("#");
  const hash = hashParts.length ? `#${hashParts.join("#")}` : "";
  const q = beforeHash.indexOf("?");
  if (q < 0) return url;

  const base = beforeHash.slice(0, q);
  const params = new URLSearchParams(beforeHash.slice(q + 1));
  params.delete(INVITATION_PARAM);
  params.delete(LEGACY_INVITE_PARAM);
  const rest = params.toString();
  return `${base}${rest ? `?${rest}` : ""}${hash}`;
}

/**
 * What to offer as the shareable thing.
 *
 * Always a link now: the platform host is a constant, so unlike the old
 * origin-derived version there is no environment in which a link cannot be
 * built — the desktop shell included, which is exactly where the old code had to
 * fall back to a bare code because `tauri://` is not an origin worth sharing.
 * The raw code remains available as a disclosure for cross-app pasting.
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
