// ── The invitation payload, on the wire ──────────────────────────────────────
//
// MeroSign shares an agreement by handing someone a signed invitation to the
// agreement's CONTEXT. There are two kinds the node will accept, and this module
// is the one place that knows the difference:
//
//   * an OPEN invitation (`admin-api/contexts/invite_by_open_invitation`) — a
//     `SignedOpenInvitation` that anyone holding it may redeem with a freshly
//     created identity. This is what a shareable link carries.
//   * a TARGETED invitation (`admin-api/contexts/invite`) — an opaque base58
//     string minted FOR one named invitee public key, redeemed through
//     `admin-api/contexts/join`.
//
// Both travel as one pasteable string. An open invitation is wrapped in a small
// envelope, deflate-compressed and base58-encoded — the same shape mero-stream,
// mero-chat and mero-blocks use, so a code minted by any of them is shaped
// identically and this app's decoder recognises theirs.
//
// Why compress: a `SignedOpenInvitation` is a few hundred bytes of JSON with a
// signature in it. The previous version of this app put that JSON, raw and
// `encodeURIComponent`-ed, straight into a query string — a link of roughly
// 1,200 characters, most of it percent-escapes, which chat clients wrap and mail
// clients truncate. deflate+base58 gets the same payload to a single short line
// with no character that survives copy-paste badly (no `+`, `/`, `=`, no quotes,
// no whitespace).
//
// Pure functions, no DOM and no network, so the tests can import them directly.

import bs58 from 'bs58';
import { deflateSync, inflateSync } from 'fflate';

/**
 * The node's `SignedOpenInvitation`, loosely typed.
 *
 * Deliberately NOT the SDK's exact interface: field spelling has changed across
 * core releases (`inviterSignature` / `inviter_signature`, `contextId` /
 * `context_id`) and a decoder that insists on one spelling rejects a valid
 * invitation minted by a node one release away. What we require is the shape
 * that makes it an invitation at all — an `invitation` object and a signature.
 */
export interface SignedOpenInvitationLike {
  invitation: Record<string, unknown>;
  inviterSignature?: string;
  inviter_signature?: string;
}

/** What a decoded code turned out to be. */
export type InviteKind = 'open' | 'targeted';

export interface MeroSignInvitePayload {
  kind: InviteKind;
  /** Present for `kind: "open"` — redeem via `joinContextByOpenInvitation`. */
  invitation?: SignedOpenInvitationLike;
  /** Present for `kind: "targeted"` — redeem via `joinContext`. */
  targetedPayload?: string;
  /**
   * The agreement's context id, as a routing/display hint.
   *
   * For an open invitation the authoritative value is read out of the SIGNED
   * body by {@link contextIdOfInvite}; this wrapper field is convenience only
   * and must never be used to decide what to join.
   */
  contextId?: string;
  /**
   * The agreement name the inviter typed, carried so the prompt can say WHAT
   * you are being invited to before you commit to joining.
   *
   * ⚠️ A DISPLAY HINT AND NOTHING MORE. It sits outside the signature, so
   * anybody can change it. The name MeroSign actually records and shows for an
   * agreement is read back from the contract's replicated `context_name` after
   * the join (see `lib/agreementName.ts`); this is only what we show while the
   * join is still in flight, and the fallback if the contract has not synced.
   */
  contextName?: string;
  /**
   * The workspace name the inviter typed, for the same reason as
   * {@link contextName} and with the same caveat: a display hint outside the
   * signature. The namespace actually joined is read from the SIGNED body by
   * {@link namespaceIdOfInvite}.
   */
  workspaceName?: string;
}

function isSignedInvitation(v: unknown): v is SignedOpenInvitationLike {
  if (!v || typeof v !== 'object') return false;
  const t = v as SignedOpenInvitationLike;
  return (
    (typeof t.inviterSignature === 'string' ||
      typeof t.inviter_signature === 'string') &&
    !!t.invitation &&
    typeof t.invitation === 'object'
  );
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Peel the admin-api response envelope, if one is still on it.
 *
 * This matters more than it looks. `apiClient.node()` hands back the node's raw
 * response body, and core answers `invite_by_open_invitation` as
 * `{"data": {invitation, inviterSignature}}`. The minting screen used to
 * `JSON.stringify` that whole thing, and the joining screen parsed it straight
 * back as a `SignedOpenInvitation` and posted it as the `invitation` field — so
 * the node received `{"invitation": {"data": {…}}}`, which every core request
 * body rejects outright because they are all `deny_unknown_fields`. Unwrapping
 * here, rather than at one call site, means neither end has to know whether the
 * node of the day wraps or not.
 */
function unwrapEnvelope(
  value: unknown,
  /**
   * Follow an `invitation` key as well as `data`.
   *
   * ⚠️ ONLY TRUE FOR THE INNER CALL. At the top level `{invitation, contextId,
   * contextName}` IS this app's own wrapper — descending it there discards the
   * name and id hints that sit beside the invitation, which is what the
   * round-trip tests caught the moment it was done unconditionally.
   */
  descendInvitation = false,
): unknown {
  let cur = value;
  // Bounded: a legitimately nested envelope is not deep, and an unbounded loop
  // on adversarial input is a denial of service.
  for (let i = 0; i < 6; i += 1) {
    if (!cur || typeof cur !== 'object') return cur;
    if (isSignedInvitation(cur)) return cur;
    const obj = cur as Record<string, unknown>;
    // ⚠️ `invitation` AS WELL AS `data`, and this is the whole of the reported
    // join failure.
    //
    // `createNamespaceInvitation` answers
    //
    //     { invitation: { invitation, inviter_signature, … }, groupName }
    //
    // so the SIGNED object is two levels down, not one. Descending only `data`
    // left `{invitation, groupName}` — which carries no signature at its own
    // level — so `isSignedInvitation` was false, `parsePayload` returned null,
    // and `decodeInvite` fell through to its last resort and classified a
    // perfectly good open invitation as a legacy TARGETED payload.
    //
    // ⚠️ That failure was invisible, because `decodeInvite` still returned a
    // truthy object. Redemption then took the targeted path — straight to
    // `joinContext`, which wants a 64-hex context id and answered
    //
    //     Invalid context id format: expected 64 hex characters (32 bytes)
    //
    // and later, once that was reported honestly, "that invitation cannot be
    // redeemed". The invitation was fine. The codec was reading it wrong.
    const inner =
      obj.data !== undefined
        ? obj.data
        : descendInvitation
          ? obj.invitation
          : undefined;
    if (inner === undefined) return cur;
    cur = inner;
  }
  return cur;
}

function parsePayload(json: string): MeroSignInvitePayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const inner = unwrapEnvelope(parsed);
  if (!inner || typeof inner !== 'object') return null;

  // Our wrapped form: {invitation, contextId?, contextName?}
  const wrapper = inner as Record<string, unknown>;
  // `true`: here the signed object really is further down — the node answers
  // `{invitation: {invitation, inviter_signature, …}, groupName}`.
  const maybeInvitation = unwrapEnvelope(wrapper.invitation, true);
  if (isSignedInvitation(maybeInvitation)) {
    return {
      kind: 'open',
      invitation: maybeInvitation,
      contextId: str(wrapper.contextId) ?? str(wrapper.context_id),
      // `groupAlias` is what the chat-era apps call the human name; accepted so
      // a code minted by another mero app still shows a name here.
      contextName:
        str(wrapper.contextName) ??
        str(wrapper.context_name) ??
        str(wrapper.groupAlias) ??
        str(wrapper.groupName),
      workspaceName:
        str(wrapper.workspaceName) ?? str(wrapper.namespaceName) ?? undefined,
    };
  }

  // A bare `SignedOpenInvitation` — what the admin API returns, and what someone
  // debugging will paste.
  if (isSignedInvitation(inner)) {
    return { kind: 'open', invitation: inner };
  }
  return null;
}

/** Compress + base58-encode an open invitation into the shareable code. */
export function encodeInvite(payload: {
  invitation: SignedOpenInvitationLike;
  contextId?: string;
  contextName?: string;
  workspaceName?: string;
}): string {
  const body: Record<string, unknown> = { invitation: payload.invitation };
  if (payload.contextId) body.contextId = payload.contextId;
  if (payload.contextName) body.contextName = payload.contextName;
  if (payload.workspaceName) body.workspaceName = payload.workspaceName;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  return bs58.encode(deflateSync(bytes, { level: 9 }));
}

/**
 * Decode whatever a person pasted or a link carried. Accepts, in order:
 *
 *   - base58(deflate(JSON))  — what {@link encodeInvite} produces
 *   - base58(JSON)           — uncompressed, for codes from other mero apps
 *   - raw JSON               — including the `{"data": …}` the admin API returns,
 *                              and the `?invitation=<json>` links this app used
 *                              to mint, which are still out there
 *   - anything else base58    — a TARGETED invitation payload, which is opaque
 *                              to us and is handed to `contexts/join` as-is
 *
 * Returns null only for input that cannot be an invitation at all. This is user
 * input, so every caller wants "that is not a valid invitation" rather than an
 * exception.
 */
export function decodeInvite(input: string): MeroSignInvitePayload | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return parsePayload(trimmed);

  let bytes: Uint8Array | null = null;
  try {
    bytes = bs58.decode(trimmed);
  } catch {
    bytes = null;
  }

  if (bytes) {
    let json: string | null = null;
    try {
      json = new TextDecoder().decode(inflateSync(bytes));
    } catch {
      try {
        json = new TextDecoder().decode(bytes); // uncompressed legacy form
      } catch {
        json = null;
      }
    }
    if (json && json.trim().startsWith('{')) {
      const parsed = parsePayload(json);
      if (parsed) return parsed;
    }
  }

  // Not one of our envelopes: treat it as a TARGETED invitation, which is opaque
  // to us — only the node can read it, and only the node can say whether it is
  // valid. Deliberately not gated on "is it base58": the targeted payload's
  // encoding is the node's business and has changed before, and refusing one we
  // do not recognise would turn a working invitation into a local error message
  // for no gain. The length floor is the one sanity check worth keeping — it
  // stops a stray word being posted to the node as an invitation.
  if (trimmed.length < 32) return null;
  return { kind: 'targeted', targetedPayload: trimmed };
}

/**
 * The context id an open invitation actually grants, read out of the SIGNED body
 * rather than the wrapper beside it — so editing the envelope cannot redirect a
 * join at somebody else's agreement.
 *
 * Core has shipped this as both a byte array and a hex string; hex-encode the
 * former. Both key spellings are tolerated.
 */
export function contextIdOfInvite(
  payload: MeroSignInvitePayload | SignedOpenInvitationLike,
): string {
  return signedField(payload, ['contextId', 'context_id']);
}

/**
 * The WORKSPACE an open invitation grants, read out of the signed body.
 *
 * This is the one value the join flow cannot do without: `joinNamespace` takes
 * the namespace in the path, and a namespace id read from the envelope beside
 * the signature could be edited to point a joiner at a different workspace.
 * Core spells it `group_id` in the signed invitation — a namespace IS a root
 * group — and ships it as a byte array, which is hex-encoded here.
 */
export function namespaceIdOfInvite(
  payload: MeroSignInvitePayload | SignedOpenInvitationLike,
): string {
  return signedField(payload, ['group_id', 'groupId', 'namespaceId']);
}

/** Read one id out of the SIGNED body, hex-encoding a byte array. */
function signedField(
  payload: MeroSignInvitePayload | SignedOpenInvitationLike,
  keys: string[],
): string {
  const signed = isSignedInvitation(payload)
    ? payload
    : (payload as MeroSignInvitePayload).invitation;
  const body = signed?.invitation as Record<string, unknown> | undefined;
  for (const key of keys) {
    const raw = body?.[key];
    if (Array.isArray(raw)) {
      return (raw as number[])
        .map((b) => Number(b).toString(16).padStart(2, '0'))
        .join('');
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return '';
}
