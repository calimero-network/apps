/**
 * Core's public links, the one place this app makes, lists and revokes them.
 *
 * An instance's access is one list of grants, and a public link is one of
 * them: a `link` grant (`{ kind: "link", link, label?, expiresAt?,
 * ratePerMinute, createdBy, createdAt }`, among the `grants` of
 * `GET /apps/{app}`). It has routes of its own, the only way to make or
 * revoke one (`POST /apps/{app}/access` keeps an instance's links as they
 * are): whoever may change the instance's access makes one with their passkey
 * (`client.apps.publicLinkCreate`, answered `{ link, token }` once), lists
 * them (`publicLinkList`, never a token) and revokes one (`publicLinkRevoke`;
 * its creator may too). Below cluster version 1.0.0-rc.33 the node answers
 * `409 FEATURE_NOT_ACTIVE`.
 *
 * Core keeps only the token's public key (`link`), and admits the token's
 * holders as anonymous visitors (`Caller::Visitor { link, key }`) to the
 * instance's `#[app::public]` methods while the link lives: not revoked, not
 * past `expiresAt`, within `ratePerMinute` calls per visitor. A visitor's
 * client is mero-js's `client.useVisitor({ link: token, seed })`, which signs
 * every request with the visitor's own Ed25519 key; the seed stays in this
 * browser's local storage (`visitorSeed`), so a visitor stays the same one
 * across visits.
 */
import {
  newVisitorSeed,
  type ApiOperations,
  type CalimeroClient,
  type ConfirmCallback,
} from "@calimero-network/mero-js";

/** Calls one visitor may make through a link a minute (core's default is 60, its maximum 600). */
export const LINK_RATE_PER_MINUTE = 20;

/** The longest label core keeps on a link. */
export const MAX_CORE_LABEL = 64;

/** What `publicLinkCreate` answers, once: the token is in no list. */
export type MadePublicLink = ApiOperations["public_link_create"]["responses"][200]["content"]["application/json"];

/** A link as core lists it, for whoever may change the instance's access. */
export type CorePublicLink =
  ApiOperations["public_link_list"]["responses"][200]["content"]["application/json"]["links"][number];

export interface PublicLinkTerms {
  label?: string;
  /** Unix seconds; omitted: until revoked. */
  expiresAt?: number;
  ratePerMinute?: number;
}

type LinkClient = Pick<CalimeroClient, "apps">;

/** Make a public link of `app`: the caller's passkey approves it (`confirm`). */
export async function createPublicLink(
  client: LinkClient,
  app: string,
  terms: PublicLinkTerms,
  confirm: ConfirmCallback,
): Promise<MadePublicLink> {
  const label = terms.label?.replace(/\s+/g, " ").trim().slice(0, MAX_CORE_LABEL);
  const made = await client.apps.publicLinkCreate(
    {
      app,
      ratePerMinute: terms.ratePerMinute ?? LINK_RATE_PER_MINUTE,
      ...(label ? { label } : {}),
      ...(terms.expiresAt !== undefined ? { expiresAt: terms.expiresAt } : {}),
    },
    { confirm },
  );
  if (!made?.link || !made?.token) throw new Error("the node made no public link");
  return { link: made.link, token: made.token };
}

/** `app`'s public links as core keeps them (only for whoever may change its access). */
export async function listPublicLinks(client: LinkClient, app: string): Promise<CorePublicLink[]> {
  return (await client.apps.publicLinkList({ app })).links ?? [];
}

/** Revoke a link: it admits nobody from the next request. One already gone is fine. */
export async function revokePublicLink(
  client: LinkClient,
  app: string,
  link: string,
  confirm: ConfirmCallback,
): Promise<void> {
  await client.apps.publicLinkRevoke({ app, link }, { confirm }).catch((e: { status?: number }) => {
    if (e?.status !== 404) throw e;
  });
}

// ── visitors ────────────────────────────────────────────────────────────────

const SEED_KEY = "mero-forms/visitor-seed";

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** This browser's visitor seed: kept in local storage, new when there is none (or no storage). */
export function visitorSeed(storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage()): Uint8Array {
  try {
    const kept = storage?.getItem(SEED_KEY);
    if (kept && /^[0-9a-f]{64}$/.test(kept)) {
      return Uint8Array.from(kept.match(/../g)!, (b) => parseInt(b, 16));
    }
  } catch {
    // No storage: a new visitor each visit.
  }
  const seed = newVisitorSeed();
  try {
    storage?.setItem(SEED_KEY, hex(seed));
  } catch {
    // Kept for this visit only.
  }
  return seed;
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
