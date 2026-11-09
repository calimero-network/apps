/**
 * An invite link, from the address bar to the join, the same in every app:
 *
 * - **The link** ({@link inviteLink}): at the origin's root, the token and
 *   where it points (org, team, doc, route) in the query. Never pinned to the
 *   inviter's `/{version}/`, which goes stale after an upgrade and 404s once
 *   pruned; the cluster's served-host redirect keeps the query.
 * - **The pending invite** ({@link createInviteStore}): captured once before
 *   anything renders, kept per app and per cluster, dropped on sign-out and
 *   when another account signs in, with subscribers told of every change.
 * - **Whether it is used up** ({@link inviteRefusal}): only the node's word
 *   that the invite is unknown, spent, expired or its organization gone. A
 *   lapsed session (401), a rate limit (429), a 5xx or a network failure
 *   keeps the token for another try.
 * - **Who may add an instance** ({@link canCreateIn}): core's `CREATE_APP`
 *   rule, so a member who may not is told to ask an owner instead of being
 *   shown a create button that fails.
 */
import {
  CalimeroError,
  DEFAULT_ORG_CAPABILITIES,
  ORG_CAPABILITIES,
  SignUpRefused,
  type CalimeroClient,
} from "@calimero-network/mero-js";

import { describeError, type KeyValueStorage } from "./client";
import { targetKey, type Target } from "./target";

// ------------------------------------------------------------------ refusals

/** Why the node says an invite cannot be used. */
export type InviteRefusal = "unknown-invite" | "expired-invite" | "org-gone";

/**
 * The node's sentences for an invite that is done, old core and new: a
 * sign-up's `403 SIGN_UP_REFUSED` and a redemption's `400 REJECTED`.
 * mero-js 29.7.7 reads core rc.12's "used up, revoked or never existed" as
 * reason `other`, so the sentence is read here too.
 */
const REFUSALS: ReadonlyArray<readonly [RegExp, InviteRefusal]> = [
  [/\bunknown invite\b|used up, revoked or never existed/i, "unknown-invite"],
  [/\binvite (?:has )?expired\b/i, "expired-invite"],
  [/organization is gone|no such organization/i, "org-gone"],
];

/**
 * Why the node refused an invite (at a sign-up or a redemption), or `null`
 * when the failure says nothing about the invite: a lapsed session (401), a
 * timeout (408), a rate limit (429), the cluster unavailable (5xx), a network
 * failure, or a refusal by the cluster's sign-up policy.
 */
export function inviteRefusal(error: unknown): InviteRefusal | null {
  if (!(error instanceof CalimeroError)) return null;
  if (error instanceof SignUpRefused) {
    const r = error.reason as string;
    if (r === "unknown-invite" || r === "expired-invite" || r === "org-gone") return r;
  }
  const { status } = error;
  if (status < 400 || status >= 500 || status === 401 || status === 408 || status === 429) return null;
  for (const [pattern, reason] of REFUSALS) {
    if (pattern.test(error.message)) return reason;
  }
  return null;
}

/** The invite is used up, unknown, expired or its organization gone: drop it. Anything else keeps it. */
export function isSpentInvite(error: unknown): boolean {
  return inviteRefusal(error) !== null;
}

/** What the invitation screens say once an invite cannot be used. */
export const SPENT_INVITE_COPY =
  "This invite was already used or has expired. Ask the person who invited you for a new link.";

/** One sentence for a refused invite, by why. */
export function describeInviteRefusal(reason: InviteRefusal): string {
  switch (reason) {
    case "unknown-invite":
      return "That invite was used up, revoked or never existed: ask whoever sent it for a new one.";
    case "expired-invite":
      return "That invite has expired or has no uses left: ask whoever sent it for a new one.";
    case "org-gone":
      return "The organization that invite was for no longer exists: ask for an invite to another one.";
  }
}

/**
 * What a failed redemption says: a spent invite plainly
 * ({@link SPENT_INVITE_COPY}), anything else as worth another try, the
 * token kept.
 */
export function describeRedeemFailure(error: unknown): string {
  if (isSpentInvite(error)) return SPENT_INVITE_COPY;
  if (error instanceof CalimeroError && error.status === 401) {
    return "Your session ended before the invitation was accepted: sign in again. Your invite is kept.";
  }
  if (error instanceof CalimeroError && error.status === 429) {
    return "Too many tries just now: wait a moment and try again. Your invite is kept.";
  }
  return `The invitation could not be accepted: ${describeError(error)}. Check your connection and try again; your invite is kept.`;
}

// ---------------------------------------------------------------- the link

/** The query parameters an invite link carries. */
export const INVITE_PARAMS = { token: "invite", org: "org", team: "team", doc: "doc", route: "to" } as const;

/** Where an invite link points, besides its token. */
export interface InviteTarget {
  /** The organization the invite joins: a member is told "you're in already" instead of spending a use. */
  org?: string | null;
  /** The team it names, when it names one. */
  team?: string | null;
  /** The document, item or instance it opens, when it names one. */
  doc?: string | null;
  /** The app route to open after joining, relative to the router's basename (`/deals/7`). */
  route?: string | null;
  /** The app's own parameters (`forum`, `lobby`, ...), kept with the invite. */
  extra?: Record<string, string | null | undefined>;
}

export interface InviteLinkOptions extends InviteTarget {
  /** The page origin the link opens. Default: this page's. */
  origin?: string;
  /**
   * The path the link opens. Default `/`, the root: a served host redirects
   * it to the newest release with its query kept (core's served-host
   * redirect), and a dev server serves it as is.
   */
  root?: string;
}

/** The link that opens this app with `token` to redeem, and where it points. */
export function inviteLink(token: string, options: InviteLinkOptions = {}): string {
  const origin = options.origin ?? globalThis.location?.origin;
  if (!origin) throw new Error("inviteLink needs an origin outside a browser");
  const url = new URL(options.root ?? "/", origin);
  url.searchParams.set(INVITE_PARAMS.token, token);
  for (const key of ["org", "team", "doc"] as const) {
    const v = options[key];
    if (v) url.searchParams.set(INVITE_PARAMS[key], v);
  }
  const route = safeRoute(options.route ?? null);
  if (route) url.searchParams.set(INVITE_PARAMS.route, route);
  for (const [k, v] of Object.entries(options.extra ?? {})) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

/** An in-app path: `/x`, never `//host`, `/\host` or a scheme. `/` is the front door: `null`. */
function safeRoute(route: string | null): string | null {
  if (!route || !/^\/(?![/\\])/.test(route) || route === "/") return null;
  return route;
}

// ---------------------------------------------------------------- the store

/** The invite this page holds, and where its link pointed. */
export interface PendingInvite {
  token: string;
  org: string | null;
  team: string | null;
  doc: string | null;
  /** The route to open after joining, relative to the basename; `null` for the front door. */
  route: string | null;
  /** The app's own parameters it asked to keep (`keep`). */
  extra: Record<string, string>;
}

interface Stored extends PendingInvite {
  /** The account the invite is held for, once one signed in with it pending. */
  account?: string | null;
}

export interface InviteStoreOptions {
  storage?: KeyValueStorage;
  /** The app's own link parameters to keep with the invite (and take off the address bar). */
  keep?: readonly string[];
}

export interface CaptureOptions {
  /**
   * The router's basename, for a version-pinned link's route (`/1.2.0/deals/7`
   * is `/deals/7`). Default `/`. A served page's is `/{version}/`.
   */
  basename?: string;
  /** Where the cleaned address goes. Default: the page's history; `null` leaves the address bar alone. */
  history?: Pick<History, "replaceState"> | null;
}

/**
 * The pending invite of one app, captured once and kept until it is used,
 * refused, declined or its person signs out.
 *
 * Call {@link InviteStore.capture} before anything renders (`main.tsx`): a
 * person opening a link is usually not signed in yet, and the token must
 * survive the sign-up. The session binds it to the cluster it connects to
 * ({@link InviteStore.bind}); from then it is kept under that cluster's key.
 */
export interface InviteStore {
  /** Takes `?invite=` (and what the link names) off the address bar into storage. `null` when the page has no invite. */
  capture(location?: Pick<Location, "href">, options?: CaptureOptions): PendingInvite | null;
  /** Keep the invite under `target`'s key: one captured on this load moves there. */
  bind(target: Target): void;
  /** The pending invite, the same object until it changes; `null` for none. */
  pending(): PendingInvite | null;
  /** Its token; `null` for none. Pass as `usePasskeySession`'s `invite`. */
  token(): string | null;
  /** Hold `invite` as the pending one (an app moving an older stored format over). */
  put(invite: PendingInvite): void;
  /** Forget it: joined, refused, declined. */
  drop(): void;
  /** An account signed in: the invite is held for it, and dropped when it was held for another. */
  signedIn(accountId: string): void;
  /** The person signed out: the next one on this browser is not asked to join. */
  signedOut(): void;
  /** Called on every change, also from another tab; answers the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

const KEY_PREFIX = "calimero-invite:";

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    return undefined;
  }
}

function text(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parse(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const token = text(v?.token);
    if (!token) return null;
    const extra: Record<string, string> = {};
    if (v.extra && typeof v.extra === "object") {
      for (const [k, x] of Object.entries(v.extra as Record<string, unknown>)) {
        if (typeof x === "string") extra[k] = x;
      }
    }
    return {
      token,
      org: text(v.org),
      team: text(v.team),
      doc: text(v.doc),
      route: safeRoute(text(v.route)),
      extra,
      account: text(v.account),
    };
  } catch {
    return null;
  }
}

function publicView(s: Stored): PendingInvite {
  const { account: _account, ...rest } = s;
  return rest;
}

/** The pending-invite store of `app` (a name unique on the origin, as for the session store). */
export function createInviteStore(app: string, options: InviteStoreOptions = {}): InviteStore {
  const storage = options.storage ?? defaultStorage();
  const keep = options.keep ?? [];
  const unboundKey = `${KEY_PREFIX}${app}`;
  let boundKey: string | null = null;
  /** The invite when storage refused it: kept for this page only. */
  let memory: string | null = null;
  let lastRaw: string | null = null;
  let lastView: PendingInvite | null = null;
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;

  const key = () => boundKey ?? unboundKey;
  const get = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null;
    } catch {
      return null;
    }
  };
  const remove = (k: string) => {
    try {
      storage?.removeItem(k);
    } catch {
      /* nothing stored */
    }
  };
  /** `true` when storage holds it. */
  const write = (value: Stored): boolean => {
    const raw = JSON.stringify(value);
    try {
      if (!storage) throw new Error("no storage");
      storage.setItem(key(), raw);
      memory = null;
      return true;
    } catch {
      memory = raw;
      return false;
    }
  };
  const notify = () => {
    for (const l of [...listeners]) l();
  };
  const read = (): Stored | null => parse(memory ?? get(key()));

  const store: InviteStore = {
    capture(location = globalThis.location, { basename = "/", history = globalThis.history } = {}) {
      if (!location) return null;
      const url = new URL(location.href);
      const token = url.searchParams.get(INVITE_PARAMS.token)?.trim();
      if (!token) return null;
      const param = (name: string) => text(url.searchParams.get(name)?.trim());
      const extra: Record<string, string> = {};
      for (const k of keep) {
        const v = param(k);
        if (v) extra[k] = v;
      }
      const base = basename.endsWith("/") ? basename : `${basename}/`;
      const fromPath = url.pathname.startsWith(base) ? `/${url.pathname.slice(base.length)}` : url.pathname;
      const invite: PendingInvite = {
        token,
        org: param(INVITE_PARAMS.org),
        team: param(INVITE_PARAMS.team),
        doc: param(INVITE_PARAMS.doc),
        // A root link says where it points in `to`; a version-pinned one, in its path.
        route: url.searchParams.has(INVITE_PARAMS.route)
          ? safeRoute(param(INVITE_PARAMS.route))
          : safeRoute(fromPath),
        extra,
      };
      const stored = write(invite);
      notify();
      // The address bar is cleaned only once the token is safe in storage:
      // otherwise a reload still finds it there.
      if (stored && history) {
        for (const k of [...Object.values(INVITE_PARAMS), ...keep]) url.searchParams.delete(k);
        history.replaceState(null, "", url.toString());
      }
      return invite;
    },

    bind(target) {
      const next = `${KEY_PREFIX}${app}:${targetKey(target)}`;
      if (boundKey === next) return;
      const fresh = memory ?? get(unboundKey);
      boundKey = next;
      if (fresh !== null) {
        const parsed = parse(fresh);
        remove(unboundKey);
        memory = null;
        if (parsed) write(parsed);
      }
      notify();
    },

    pending() {
      const raw = memory ?? get(key());
      if (raw === lastRaw) return lastView;
      lastRaw = raw;
      const parsed = parse(raw);
      lastView = parsed ? publicView(parsed) : null;
      return lastView;
    },

    token() {
      return store.pending()?.token ?? null;
    },

    put(invite) {
      write({ ...invite, route: safeRoute(invite.route) });
      notify();
    },

    drop() {
      memory = null;
      remove(unboundKey);
      if (boundKey) remove(boundKey);
      notify();
    },

    signedIn(accountId) {
      const held = read();
      if (!held || held.account === accountId) return;
      if (held.account) {
        store.drop();
        return;
      }
      write({ ...held, account: accountId });
    },

    signedOut() {
      if (read() !== null) store.drop();
    },

    subscribe(listener) {
      listeners.add(listener);
      if (!detach && typeof globalThis.addEventListener === "function") {
        const onStorage = (e: StorageEvent) => {
          if (e.key === null || e.key.startsWith(`${KEY_PREFIX}${app}`)) notify();
        };
        globalThis.addEventListener("storage", onStorage);
        detach = () => globalThis.removeEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && detach) {
          detach();
          detach = null;
        }
      };
    },
  };
  return store;
}

// ------------------------------------------------------------ membership

/**
 * Whether the signed-in account is in `org`: `null` when that cannot be told
 * (the caller then asks, as for a link that names no org). Redeeming spends a
 * use even for a member, so a link that names its org is checked first.
 */
export async function memberOf(client: Pick<CalimeroClient, "me">, org: string): Promise<boolean | null> {
  try {
    const me = (await client.me()) as { orgs?: Array<{ orgId?: unknown }> };
    return (me.orgs ?? []).some((o) => o.orgId === org);
  } catch {
    return null;
  }
}

/** The org a redemption joined, from whichever field the node named it in. */
export function joinedOrg(redeemed: unknown): string | null {
  if (!redeemed || typeof redeemed !== "object") return null;
  for (const k of ["org", "orgId"]) {
    const v = (redeemed as Record<string, unknown>)[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// ------------------------------------------------------------ CREATE_APP

/** The parts of `getOrg`'s answer (core's `Org`) the `CREATE_APP` rule reads. */
export interface OrgAccessView {
  members?: Record<string, string>;
  defaultCapabilities?: number;
  capabilities?: Record<string, number>;
  teams?: Record<string, OrgTeamView | undefined>;
}

/** A team in {@link OrgAccessView}: `members` maps an account to whether it leads the team. */
export interface OrgTeamView {
  parent?: string | null;
  members?: Record<string, boolean>;
  capabilities?: Record<string, number>;
}

const AT_LEAST_MEMBER = new Set(["member", "admin", "owner"]);
const ADMIN = new Set(["admin", "owner"]);

/**
 * Whether `account` may create an app in `org` (on `team`, or org-wide), as
 * core decides it (`Org::may` with `CREATE_APP`): a member or above, and
 * then an admin or owner; a lead of the team or of a team above it; or a
 * member holding `CREATE_APP` on that team's row, else org-wide (a member's
 * own grant, else the org's default, which leaves it out).
 *
 * Team membership itself (core's "not a member of that team") is the app's
 * own check.
 */
export function mayCreateIn(org: OrgAccessView, account: string, team?: string | null): boolean {
  const role = org.members?.[account];
  if (!role || !AT_LEAST_MEMBER.has(role)) return false;
  if (ADMIN.has(role)) return true;
  const orgCaps = org.capabilities?.[account] ?? org.defaultCapabilities ?? DEFAULT_ORG_CAPABILITIES;
  if (!team) return (orgCaps & ORG_CAPABILITIES.CREATE_APP) !== 0;
  // A lead of the team or of one above it manages it.
  let cur: string | null | undefined = team;
  for (let hops = 0; cur && hops <= 32; hops++) {
    const t: OrgTeamView | undefined = org.teams?.[cur];
    if (!t) break;
    if (t.members?.[account] === true) return true;
    cur = t.parent;
  }
  const caps = org.teams?.[team]?.capabilities?.[account] ?? orgCaps;
  return (caps & ORG_CAPABILITIES.CREATE_APP) !== 0;
}

/**
 * {@link mayCreateIn} for the signed-in account, from the node's `getOrg`.
 * `null` when it cannot be told (no session, the org unreadable): show the
 * create action and let the node decide.
 */
export async function canCreateIn(
  client: Pick<CalimeroClient, "getOrg" | "session">,
  org: string,
  team?: string | null,
): Promise<boolean | null> {
  const account = client.session?.accountId;
  if (!account) return null;
  try {
    return mayCreateIn((await client.getOrg(org)) as OrgAccessView, account, team);
  } catch {
    return null;
  }
}

/** What a member who may not add one sees instead of a create button: `thing` is "a workspace", "a calendar". */
export function askAnOwnerCopy(thing: string): string {
  return `Only an owner or admin of this organization can add ${thing} here, or a member they allowed to. Ask one of them to add it, or to let you.`;
}
