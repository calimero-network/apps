/**
 * Core's public links (core#5195), the one place this app calls them.
 *
 * An instance's access is one list of grants, and a public link is one of
 * them: a `link` grant (`{ kind: "link", link, label?, expiresAt?,
 * ratePerMinute, createdBy, createdAt }`, among the `grants` of
 * `GET /apps/{app}`). It has routes of its own, the only way to make or
 * revoke one (`POST /apps/{app}/access` keeps an instance's links as they
 * are): whoever may change the instance's access makes one with their passkey
 * (`POST /apps/{app}/public-links`, answered `{ link, token }` once), lists
 * them (`GET`, never a token) and revokes one
 * (`DELETE /apps/{app}/public-links/{link}`; its creator may too).
 * Core keeps only the token's public key (`link`), and admits the token's
 * holders as anonymous visitors (`Caller::Visitor { link, key }`) to the
 * instance's `#[app::public]` methods while the link lives: not revoked, not
 * past `expiresAt`, within `ratePerMinute` calls per visitor.
 *
 * A visitor signs every request with its own Ed25519 key (`vis1.` bearer,
 * mero-js `useVisitor({ link, seed })`); the seed stays in this browser's
 * local storage, so a visitor stays the same one across visits.
 *
 * TODO(core#5195): the published mero-js (^36) has neither the link routes nor
 * `useVisitor`. Once the release with core#5195 is out (1.0.0-rc.33: below
 * that cluster version the node answers `409 FEATURE_NOT_ACTIVE`) and the
 * catalog takes it:
 * - `createPublicLink` / `listPublicLinks` / `revokePublicLink` become
 *   `client.apps.publicLinkCreate` / `publicLinkList` / `publicLinkRevoke`
 *   (generated, `{ confirm }` per request) and the untyped route client goes;
 * - `startVisitor` becomes `client.useVisitor({ link: token, seed })` alone:
 *   drop `LocalVisitor` (a copy of mero-js's `Visitor`, checked against the
 *   same vector in `coreLinks.test.ts`) and the `fresh()` re-signing, which
 *   mero-js's transport then does on every request.
 */
import {
  createRouteClient,
  errorFrom,
  type CalimeroClient,
  type ConfirmCallback,
} from "@calimero-network/mero-js";

/** Calls one visitor may make through a link a minute (core's default is 60, its maximum 600). */
export const LINK_RATE_PER_MINUTE = 20;

/** The longest label core keeps on a link. */
export const MAX_CORE_LABEL = 64;

/** What `POST /apps/{app}/public-links` answers, once: the token is in no list. */
export interface MadePublicLink {
  /** The link's key (hex): how core and the contract name it. */
  link: string;
  /** The secret the link's URL carries. */
  token: string;
}

/** A link as core lists it, for whoever may change the instance's access. */
export interface CorePublicLink {
  link: string;
  label?: string | null;
  /** Unix seconds; none: until revoked. */
  expiresAt?: number | null;
  expired: boolean;
  ratePerMinute: number;
  createdBy: string;
  createdAt: number;
}

export interface PublicLinkTerms {
  label?: string;
  /** Unix seconds; omitted: until revoked. */
  expiresAt?: number;
  ratePerMinute?: number;
}

type Untyped = {
  [M in "GET" | "POST" | "DELETE"]: (
    path: string,
    init: { params: { path: Record<string, string> }; body?: unknown },
  ) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
};

/** The node's routes, untyped: the link routes are not in the published mero-js's document. */
function routes(client: CalimeroClient, confirm?: ConfirmCallback): Untyped {
  return createRouteClient(client.transport, confirm ? { confirm } : undefined) as unknown as Untyped;
}

async function answer<T>(pending: Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await pending;
  if (!response.ok || error !== undefined) throw errorFrom(response.status, error, response.headers.get("retry-after"));
  return data as T;
}

/** Make a public link of `app`: the caller's passkey approves it (`confirm`). */
export async function createPublicLink(
  client: CalimeroClient,
  app: string,
  terms: PublicLinkTerms,
  confirm: ConfirmCallback,
): Promise<MadePublicLink> {
  const body: Record<string, unknown> = { ratePerMinute: terms.ratePerMinute ?? LINK_RATE_PER_MINUTE };
  const label = terms.label?.replace(/\s+/g, " ").trim().slice(0, MAX_CORE_LABEL);
  if (label) body.label = label;
  if (terms.expiresAt !== undefined) body.expiresAt = terms.expiresAt;
  const made = await answer<MadePublicLink>(
    routes(client, confirm).POST("/apps/{app}/public-links", { params: { path: { app } }, body }),
  );
  if (!made?.link || !made?.token) throw new Error("the node made no public link");
  return { link: made.link, token: made.token };
}

/** `app`'s public links as core keeps them (only for whoever may change its access). */
export async function listPublicLinks(client: CalimeroClient, app: string): Promise<CorePublicLink[]> {
  const listed = await answer<{ links?: CorePublicLink[] }>(
    routes(client).GET("/apps/{app}/public-links", { params: { path: { app } } }),
  );
  return listed?.links ?? [];
}

/** Revoke a link: it admits nobody from the next request. One already gone is fine. */
export async function revokePublicLink(
  client: CalimeroClient,
  app: string,
  link: string,
  confirm: ConfirmCallback,
): Promise<void> {
  await answer(
    routes(client, confirm).DELETE("/apps/{app}/public-links/{link}", { params: { path: { app, link } }, body: {} }),
  ).catch((e: { status?: number }) => {
    if (e?.status !== 404) throw e;
  });
}

// ── visitors ────────────────────────────────────────────────────────────────

const PUBLIC_LINK_DOMAIN = "calimero.public-link.v1\0";
const VISITOR_DOMAIN = "calimero.visitor.v1\0";
/** The PKCS#8 prefix of an Ed25519 private key whose 32-byte seed follows. */
const PKCS8_PREFIX = [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20];
const encoder = new TextEncoder();

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function keyFromSeed(seed: Uint8Array): Promise<{ key: CryptoKey; publicKey: string }> {
  if (seed.length !== 32) throw new Error("an Ed25519 seed is 32 bytes");
  const der = concat(Uint8Array.from(PKCS8_PREFIX), seed);
  const key = await crypto.subtle.importKey("pkcs8", der as BufferSource, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", key);
  if (!jwk.x) throw new Error("the Ed25519 key has no public half");
  return { key, publicKey: hex(fromBase64Url(jwk.x)) };
}

/** A link token's key (hex), as core and the contract name the link (mero-js `publicLinkKey`). */
export async function publicLinkKey(token: string): Promise<string> {
  const seed = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoder.encode(PUBLIC_LINK_DOMAIN + token) as BufferSource),
  );
  return (await keyFromSeed(seed)).publicKey;
}

/** mero-js's `Visitor`, until the published mero-js has it (see the TODO above). */
export class LocalVisitor {
  private constructor(
    private readonly token: string,
    readonly link: string,
    private readonly key: CryptoKey,
    readonly publicKey: string,
  ) {}

  static async create(token: string, seed: Uint8Array): Promise<LocalVisitor> {
    const [link, { key, publicKey }] = await Promise.all([publicLinkKey(token), keyFromSeed(seed)]);
    return new LocalVisitor(token, link, key, publicKey);
  }

  /** The `vis1.` credential for a request at `at` (Unix seconds): valid within 5 minutes of the node's clock. */
  async bearer(at: number = Math.floor(Date.now() / 1000)): Promise<string> {
    const message = concat(
      encoder.encode(VISITOR_DOMAIN + this.link),
      Uint8Array.of(0),
      encoder.encode(this.publicKey),
      Uint8Array.of(0),
      encoder.encode(String(at)),
    );
    const signature = await crypto.subtle.sign("Ed25519", this.key, message as BufferSource);
    return `vis1.${this.token}.${this.publicKey}.${at}.${hex(signature)}`;
  }
}

/** The visitor `client` now calls as. */
export interface VisitorSession {
  /** The link's key: what the captcha pass names. */
  link: string;
  /** The visitor's public key (hex): how the app names it. */
  publicKey: string;
  /** Call before each request: signs a fresh credential where the client cannot itself. */
  fresh(): Promise<void>;
}

interface WithVisitor {
  useVisitor(args: { link: string; seed: Uint8Array }): Promise<{ link: string; publicKey: string }>;
}

/** Make `client` call as a visitor of the link whose token is `token`, with the key whose seed is `seed`. */
export async function startVisitor(client: CalimeroClient, token: string, seed: Uint8Array): Promise<VisitorSession> {
  const withVisitor = client as unknown as Partial<WithVisitor>;
  if (typeof withVisitor.useVisitor === "function") {
    const v = await withVisitor.useVisitor({ link: token, seed });
    return { link: v.link, publicKey: v.publicKey, fresh: async () => undefined };
  }
  const v = await LocalVisitor.create(token, seed);
  const fresh = async () => client.useApiKey(await v.bearer());
  await fresh();
  return { link: v.link, publicKey: v.publicKey, fresh };
}

const SEED_KEY = "mero-forms/visitor-seed";

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
  const seed = crypto.getRandomValues(new Uint8Array(32));
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
