/**
 * Organization-wide changes from a session bound to an app's frontend, on the
 * node's consent page.
 *
 * A passkey session opened on an app's served origin (`{label}.apps.…`) is
 * bound to that app's package (core#4934; `/auth/me` answers its `app`). It
 * may use the app's own instances and the app's own teams, and is refused
 * everything organization-wide: creating an organization, inviting, joining,
 * removing a member, leaving, an org's or a team's default capabilities.
 * The node's consent page does those for the person, with their passkey, on
 * the node's own origin (core#5014, #5018), and an organization created there
 * from an app's frontend gets that app's team in the same step (core#5034).
 *
 * The page is a full-page redirect. What the app was doing is kept in
 * `sessionStorage` ({@link AppConsentIntent}); on return the app calls
 * {@link resumeAppConsent}, which reads the node's decision for the request
 * this tab started (`resumeConsent`), never anything from the return URL, and
 * answers what the approval made with the intent kept for it.
 *
 * The org-app functions ({@link ./orgApp}, {@link ./appTeams}) start the page
 * themselves on a bound session; an unbound one (the cluster's own page, a
 * dev node's origin) calls the routes directly, as before.
 */
import type { CalimeroClient, ConsentRequest, ConsentStarted } from "@calimero-network/mero-js";

import type { AppSource } from "./target";
import type { ClientRoutes } from "./routes";

// ── is this session bound? ──────────────────────────────────────────────────

/** A client that may say who it is (`/auth/me`); every org-app function takes one. */
export type MaybeMe = Partial<ClientRoutes<{ auth: "me" }>> & { readonly session?: { accountId?: string } | null };

const BOUND = new WeakMap<object, { account: string | null; app: Promise<string | null> }>();

/**
 * The package this session is bound to (`/auth/me`'s `app`), or `null` for an
 * unbound session (the cluster's own page, a dev node's origin), a client that
 * cannot ask, or a node that does not say. Asked once per client and account.
 */
export function boundApp(client: MaybeMe): Promise<string | null> {
  const me = client.auth?.me;
  if (typeof me !== "function") return Promise.resolve(null);
  const account = client.session?.accountId ?? null;
  const cached = BOUND.get(client);
  if (cached && cached.account === account) return cached.app;
  const app = (async () => {
    try {
      const answer = (await me.call(client.auth, {})) as { app?: unknown } | null;
      const bound = answer?.app;
      return typeof bound === "string" && bound.length > 0 ? bound : null;
    } catch {
      // Cannot tell (signed out, a fake without it): ask again next time.
      BOUND.delete(client);
      return null;
    }
  })();
  BOUND.set(client, { account, app });
  return app;
}

/**
 * Whether this session is bound to an app's frontend: then organization-wide
 * changes go through the consent page. `override` (an option of every
 * org-app function) answers instead when given.
 */
export async function isFrontendBound(client: MaybeMe, override?: boolean): Promise<boolean> {
  if (override !== undefined) return override;
  return (await boundApp(client)) !== null;
}

/** Forget what {@link boundApp} learnt for `client` (after a sign-in on another origin, tests). */
export function forgetBoundApp(client: object): void {
  BOUND.delete(client);
}

/** Whether `error` is the node's refusal of a frontend session (`403`, "an app's frontend"). */
export function refusedOnFrontend(error: unknown): boolean {
  const e = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object") return false;
  const forbidden = e.status === 403 || e.code === 403 || e.code === "FORBIDDEN";
  return forbidden && typeof e.message === "string" && e.message.includes("app's frontend");
}

// ── errors ──────────────────────────────────────────────────────────────────

/** The person chose not to go to the consent page: nothing was changed. */
export class ConsentNotStarted extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super("Nothing was changed: the approval page was not opened.");
    this.name = "ConsentNotStarted";
    this.kind = kind;
  }
}

/**
 * What a frontend session can do neither itself nor on the consent page (no
 * kind exists for it): an org admin does it in Calimero Home. The message is
 * meant to be shown as it is.
 */
export class ManageInHomeError extends Error {
  /** What was asked, e.g. `openAppTeam`. */
  readonly action: string;
  constructor(action: string, what: string) {
    super(`${what} is done in Calimero Home by an owner or admin of the organization, not from this app.`);
    this.name = "ManageInHomeError";
    this.action = action;
  }
}

/**
 * A step that needs its own approval on the consent page, left undone (one
 * approval per page). Start it with `startAppConsent(client, error.intent)`.
 */
export class ConsentNeededError extends Error {
  readonly intent: AppConsentIntent;
  constructor(intent: AppConsentIntent, message: string) {
    super(message);
    this.name = "ConsentNeededError";
    this.intent = intent;
  }
}

// ── what the app was doing ──────────────────────────────────────────────────

/** An invite's role (core's `Role`, without the owner). */
export type InviteRole = "guest" | "member" | "admin";

/**
 * What an org-app function sent the person to the consent page for, kept in
 * this tab's `sessionStorage` until the page sends them back. `data` is the
 * app's own (what to open afterwards), kept as given.
 */
export type AppConsentIntent = { data?: unknown } & (
  | {
      kind: "createOrg";
      name: string;
      source: AppSource | null;
      /** Org-wide member defaults asked for (`createAppOrg`'s `capabilities`). */
      capabilities?: number;
    }
  | {
      kind: "createInvite";
      org: string;
      role: InviteRole;
      teams: string[];
      ttlSecs?: number;
      uses?: number;
      /** The app teams the invite names (`inviteToApp`'s `teams`). */
      appTeams: string[];
      /** The org's mode when the invite was asked (`inviteToApp`'s `mode`). */
      mode: "legacy" | "standalone" | "shared" | null;
      /** Whether it gives this app only (`appInvite`'s `appOnly`). */
      appOnly: boolean;
    }
  | { kind: "acceptInvite"; token: string; org: string | null }
  | { kind: "removeMember"; org: string; account: string }
  | { kind: "leaveOrg"; org: string }
  | { kind: "setCapabilities"; org: string; account?: string; team?: string; capabilities: number }
);

/** An intent's kind. */
export type AppConsentKind = AppConsentIntent["kind"];

/** Where the intent waits while the person is on the consent page (this tab only). */
export const APP_CONSENT_INTENT_KEY = "calimero-connect:consent-intent";

type SessionKV = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionKV(): SessionKV | undefined {
  try {
    return (globalThis as { sessionStorage?: SessionKV }).sessionStorage;
  } catch {
    return undefined;
  }
}

/** The intent waiting for the consent page's return, if any. */
export function appConsentIntent(storage: Pick<Storage, "getItem"> | undefined = sessionKV()): AppConsentIntent | null {
  try {
    const raw = storage?.getItem(APP_CONSENT_INTENT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { kind?: unknown } | null;
    return v && typeof v === "object" && typeof v.kind === "string" ? (v as AppConsentIntent) : null;
  } catch {
    return null;
  }
}

function keepIntent(intent: AppConsentIntent, storage: SessionKV | undefined): void {
  try {
    storage?.setItem(APP_CONSENT_INTENT_KEY, JSON.stringify(intent));
  } catch {
    /* no session storage: the return is still read, without the intent */
  }
}

/** Forget the kept intent. */
export function forgetAppConsentIntent(storage: SessionKV | undefined = sessionKV()): void {
  try {
    storage?.removeItem(APP_CONSENT_INTENT_KEY);
  } catch {
    /* nothing kept */
  }
}

// ── the requests ────────────────────────────────────────────────────────────

/**
 * A consent request of any kind core's page takes. mero-js types the release,
 * upgrade, `createOrg`, `createInvite` and `acceptInvite` kinds; the
 * organization kinds of core#5018 are written here until it types them.
 */
export type AppConsentRequest =
  | ConsentRequest
  | { kind: "removeMember"; subject: { org: string; account: string }; returnTo: string }
  | { kind: "leaveOrg"; subject: { org: string }; returnTo: string }
  | {
      kind: "setCapabilities";
      subject: { org: string; account?: string; team?: string; capabilities: number };
      returnTo: string;
    };

/** The consent page's request for `intent`, sending the person back to `returnTo`. */
export function appConsentRequest(intent: AppConsentIntent, returnTo: string): AppConsentRequest {
  switch (intent.kind) {
    case "createOrg":
      return { kind: "createOrg", subject: { name: intent.name }, returnTo };
    case "createInvite": {
      const subject: { org: string; role: InviteRole; teams: string[]; ttlSecs?: number; uses?: number } = {
        org: intent.org,
        role: intent.role,
        teams: intent.teams,
      };
      if (intent.ttlSecs !== undefined) subject.ttlSecs = intent.ttlSecs;
      if (intent.uses !== undefined) subject.uses = intent.uses;
      return { kind: "createInvite", subject, returnTo };
    }
    case "acceptInvite":
      return { kind: "acceptInvite", subject: { token: intent.token }, returnTo };
    case "removeMember":
      return { kind: "removeMember", subject: { org: intent.org, account: intent.account }, returnTo };
    case "leaveOrg":
      return { kind: "leaveOrg", subject: { org: intent.org }, returnTo };
    case "setCapabilities": {
      const subject: { org: string; account?: string; team?: string; capabilities: number } = {
        org: intent.org,
        capabilities: intent.capabilities,
      };
      if (intent.account !== undefined) subject.account = intent.account;
      if (intent.team !== undefined) subject.team = intent.team;
      return { kind: "setCapabilities", subject, returnTo };
    }
  }
}

// ── going there ─────────────────────────────────────────────────────────────

/** How the org-app functions send the person to the consent page. */
export interface ConsentOptions {
  /** Where the page sends the person back (default: this page, without its query). Must be the app's frontend origin. */
  returnTo?: string;
  /**
   * Runs once the node accepted the request, before leaving: show
   * `started.code`, which the node's page shows too. Answer `false` to stay
   * ({@link ConsentNotStarted}). Default: the browser's `confirm`.
   */
  confirm?: (started: ConsentStarted) => boolean | Promise<boolean>;
  /** Sends the browser to the page (default `location.assign`). */
  navigate?: (url: string) => void;
  /** Where the intent is kept (default `sessionStorage`). */
  storage?: SessionKV;
  /** The app's own data kept with the intent (what to open on return). */
  data?: unknown;
}

let defaults: ConsentOptions = {};

/**
 * The consent options every org-app function uses unless it is given its own
 * (`returnTo`, the app's `confirm` dialog): set once at start-up.
 */
export function setConsentDefaults(options: ConsentOptions): void {
  defaults = { ...options };
}

function defaultReturnTo(): string {
  const loc = (globalThis as { location?: Location }).location;
  if (!loc) throw new Error("the consent page needs a returnTo outside a browser");
  return `${loc.origin}${loc.pathname}`;
}

function defaultConfirm(started: ConsentStarted): boolean {
  const ask = (globalThis as { confirm?: (message: string) => boolean }).confirm;
  if (typeof ask !== "function") return true;
  return ask(
    "Your Calimero node will ask you to approve this with your passkey on its own page.\n\n" +
      `Check that the page shows the code ${started.code ?? ""}.`,
  );
}

/** A client that can open the consent page. */
export type ConsentClient = Partial<Pick<CalimeroClient, "openConsentPage">>;

/**
 * Keeps `intent` and sends the person to the node's consent page for it.
 * Answers the node's `ConsentStarted` once the page is opened (with the
 * default `navigate` this page then unloads); throws
 * {@link ConsentNotStarted} when the person chose to stay.
 */
export async function startAppConsent(
  client: ConsentClient,
  intent: AppConsentIntent,
  options: ConsentOptions = {},
): Promise<ConsentStarted> {
  const open = client.openConsentPage;
  if (typeof open !== "function") throw new Error("this client cannot open the consent page");
  const o = { ...defaults, ...options };
  const storage = o.storage ?? sessionKV();
  const kept: AppConsentIntent = o.data === undefined ? intent : { ...intent, data: o.data };
  const request = appConsentRequest(kept, o.returnTo ?? defaultReturnTo());
  keepIntent(kept, storage);
  let went = false;
  let started: ConsentStarted;
  try {
    // The organization kinds are not in mero-js's `ConsentRequest` yet; the node takes them.
    started = await open.call(client, request as ConsentRequest, {
      ...(o.navigate ? { navigate: o.navigate } : {}),
      confirm: async (s) => {
        went = await (o.confirm ?? defaultConfirm)(s);
        return went;
      },
    });
  } catch (e) {
    forgetAppConsentIntent(storage);
    throw e;
  }
  if (!went) {
    forgetAppConsentIntent(storage);
    throw new ConsentNotStarted(intent.kind);
  }
  return started;
}

/** A promise that never settles: the page is navigating to the consent page. */
export function leavingPage<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/**
 * {@link startAppConsent}, then never settles while the page unloads: what an
 * org-app function answers on a bound session. With a custom `navigate` (a
 * popup, a test) it settles once the page is opened, with `undefined`.
 */
export async function goToConsent<T>(
  client: ConsentClient,
  intent: AppConsentIntent,
  options: ConsentOptions = {},
): Promise<T> {
  await startAppConsent(client, intent, options);
  if (options.navigate ?? defaults.navigate) return undefined as T;
  return leavingPage<T>();
}

// ── coming back ─────────────────────────────────────────────────────────────

/** What {@link resumeAppConsent} answers, by kind. `intent` is `null` when this tab kept none for it. */
export type AppConsentReturn = { requestId: string; approved: boolean } & (
  | {
      kind: "createOrg";
      intent: Extract<AppConsentIntent, { kind: "createOrg" }> | null;
      /** The new org; its app team (`teamId`) when the node made one with it. */
      created: { orgId: string; teamId: string | null; capabilitiesError: unknown } | null;
    }
  | {
      kind: "createInvite";
      intent: Extract<AppConsentIntent, { kind: "createInvite" }> | null;
      /** The invite (`token` is a credential: keep it out of logs). */
      invite: { org: string | null; token: string; appOnly: boolean; teams: string[]; mode: string | null } | null;
    }
  | { kind: "acceptInvite"; intent: Extract<AppConsentIntent, { kind: "acceptInvite" }> | null; org: string | null }
  | { kind: "removeMember"; intent: Extract<AppConsentIntent, { kind: "removeMember" }> | null }
  | { kind: "leaveOrg"; intent: Extract<AppConsentIntent, { kind: "leaveOrg" }> | null }
  | { kind: "setCapabilities"; intent: Extract<AppConsentIntent, { kind: "setCapabilities" }> | null }
  | { kind: "other"; intent: null; result: unknown }
);

export interface ResumeAppConsentOptions {
  storage?: SessionKV;
  /** The URL the page sent the person back to (default `location.href`, whose parameters are then removed). */
  href?: string;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * On load: the node's decision on the request this tab sent to the consent
 * page, with the intent kept for it and what the approval made. `null` when
 * this page was not opened by the consent page. Throws what `resumeConsent`
 * throws for a return this tab did not start. The intent is forgotten here.
 */
export async function resumeAppConsent(
  client: Pick<CalimeroClient, "resumeConsent">,
  options: ResumeAppConsentOptions = {},
): Promise<AppConsentReturn | null> {
  const result = (await client.resumeConsent(options.href ? { href: options.href } : {})) as {
    requestId: string;
    kind: string;
    status: string;
    outcome?: Record<string, unknown>;
  } | null;
  if (!result) return null;
  const storage = options.storage ?? sessionKV();
  const kept = appConsentIntent(storage);
  forgetAppConsentIntent(storage);
  const approved = result.status === "approved";
  const outcome = approved ? (result.outcome ?? {}) : {};
  const base = { requestId: result.requestId, approved };
  const intent = kept && kept.kind === result.kind ? kept : null;
  switch (result.kind) {
    case "createOrg": {
      const i = intent as Extract<AppConsentIntent, { kind: "createOrg" }> | null;
      const orgId = text(outcome.orgId);
      const capabilitiesError =
        orgId && i?.capabilities !== undefined
          ? new ConsentNeededError(
              { kind: "setCapabilities", org: orgId, capabilities: i.capabilities },
              "The workspace was created; its member defaults need their own approval.",
            )
          : null;
      return {
        ...base,
        kind: "createOrg",
        intent: i,
        created: orgId ? { orgId, teamId: text(outcome.teamId), capabilitiesError } : null,
      };
    }
    case "createInvite": {
      const i = intent as Extract<AppConsentIntent, { kind: "createInvite" }> | null;
      const token = text(outcome.token);
      return {
        ...base,
        kind: "createInvite",
        intent: i,
        invite: token
          ? { org: i?.org ?? null, token, appOnly: i?.appOnly ?? false, teams: i?.appTeams ?? [], mode: i?.mode ?? null }
          : null,
      };
    }
    case "acceptInvite": {
      const i = intent as Extract<AppConsentIntent, { kind: "acceptInvite" }> | null;
      return { ...base, kind: "acceptInvite", intent: i, org: text(outcome.org) ?? text(outcome.orgId) };
    }
    case "removeMember":
    case "leaveOrg":
    case "setCapabilities":
      return { ...base, kind: result.kind, intent } as AppConsentReturn;
    default:
      return { ...base, kind: "other", intent: null, result };
  }
}
