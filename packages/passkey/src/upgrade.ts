/**
 * "A new version is available": the in-app offer to upgrade an app instance,
 * shown only to someone who may upgrade it. Framework-free: the shared
 * session hook (`usePasskeySession`) mounts it for every app built on it, and
 * the launchers that are not React (merraria, mero-blocks) and mero-chat's
 * module store call {@link watchUpgrades} themselves.
 *
 * Where the facts come from (core's node, over the sealed channel):
 *
 * - The version reports, `GET /auth/apps` (the account's own apps) and
 *   `GET /orgs/{org}/apps` (an organization's, for its members). A session
 *   opened on an app's frontend is bound to its package and reads that
 *   package's apps only. Per app: the release it runs (`package.version`),
 *   the newer releases it may see (`availableVersions`, oldest first), the
 *   newest of them an upgrade would take now (`latestReachable`, `null`
 *   when none would) and, when the newest is not that one, why
 *   (`latestBlocked`: a replica's node runs an older runtime than its
 *   `minRuntimeVersion`, or it would give the owner's upgrades to the
 *   publisher), and who holds its upgrades (`upgradesHeldBy`): `operator` where the
 *   cluster's governance gives app upgrades to the operator, else what the
 *   package's signed manifest declares, `owner` or `publisher`.
 * - Who may upgrade an owner-held instance (core's `SystemState::may_upgrade`):
 *   its owner, or for an organization's app a member holding
 *   `MANAGE_APPLICATION` on its team or org-wide (the owner, admins, a team's
 *   lead, or a member granted it). The report does not say whether this
 *   account may, so it is worked out the way core does from the account's
 *   role (`GET /auth/me`) or the organization (`GET /orgs/{org}`). When that
 *   cannot be read, the offer is hidden rather than shown to fail.
 *
 * Only owner-held upgrades are offered here. A publisher-held package is
 * upgraded by its publisher, from the developer console; an operator-held
 * cluster's upgrades are the operator's, from the manager. Neither is the
 * instance's people's to do, so nothing is shown for them.
 *
 * An app's own page never upgrades: core refuses `POST /apps/{app}/upgrade`
 * to a package-bound session. It asks for a consent request instead
 * (`POST /consent/requests`, mero-js's `upgradeConsent`), sends the person to
 * the node's consent page, where they approve with their passkey, and reads
 * the decision when the page sends them back ({@link finishUpgrade}).
 *
 * A release's frontend works only with that release's backend, so an
 * approval made from a page a node serves loads the instance's new release
 * at once (`/app/{app}/`, with the route and query), and that page says the
 * update is done. A frontend-only release (the same WASM) is an upgrade the
 * holder approves like any other: the report lists it in `availableVersions`.
 *
 * Upgrades are code only, so an instance several releases behind moves to the
 * newest it can reach in one upgrade: the offer is `latestReachable`, not
 * merely the newest release, and says why a newer one is out of reach. When
 * none is reachable, the prompt explains and offers no update. A node from
 * before `latestReachable` (core 1.0.0-rc.15 and earlier) is offered the
 * newest, as before.
 */
import {
  compareVersions,
  confirmationCode,
  consentReturn,
  upgradeConsent,
  ORG_CAPABILITIES,
  type AppsReport,
  type CalimeroClient,
  type ReportedApp,
} from "@calimero-network/mero-js";
import {
  describeError,
  instanceReleaseUrl,
  servedRelease,
  type ClientRoutes,
  type KeyValueStorage,
} from "@calimero-apps/connect";

/** Who holds an instance's upgrades, as core's report says (`upgradesHeldBy`). */
export type UpgradeHolder = "owner" | "publisher" | "operator";

/** Why the newest release is out of an instance's reach now, as core's report says (`latestBlocked`). */
export interface UpgradeBlocked {
  /** The newest release, which it cannot move to now. */
  version: string;
  /**
   * `runtime`: a node holding the instance runs an older runtime than the
   * release needs; `authority`: the release would hand the instance's
   * upgrades to its publisher. Anything else a newer node says is kept as is.
   */
  reason: string;
  /** The node's own words. */
  message: string;
}

/** A newer release an instance may move to, and whether this account may move it. */
export interface UpgradeOffer {
  /** The instance (app id). */
  app: string;
  /** The instance's own name, when the report gives one. */
  name: string | null;
  /** The release it runs. */
  current: string;
  /**
   * The release the offer moves it to: the newest it can reach now. When
   * `reachable` is false, the newest it may see, which it cannot move to yet.
   */
  latest: string;
  /** Whether an upgrade to `latest` would be taken now. */
  reachable: boolean;
  /** Why the newest release is not `latest` (or, unreachable, not yet possible), when the node says. */
  blocked: UpgradeBlocked | null;
  heldBy: UpgradeHolder;
  /**
   * This account may upgrade it: held by the owner side, and the account is
   * the instance's owner or holds `MANAGE_APPLICATION` for it. Never true for
   * `publisher` or `operator`.
   */
  canUpgrade: boolean;
}

/** The part of the client the offer uses. */
export type UpgradeClient = Pick<CalimeroClient, "appsReportAll"> &
  ClientRoutes<{ apps: "get"; orgs: "get"; auth: "me"; consent: "pageCreate" | "pageResult" }> & {
    readonly session?: { accountId: string } | null;
  };

// ---------------------------------------------------------------- who may upgrade

const ROLE_RANK: Record<string, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
const ALL = 0xffffffff;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Core's `SystemState::manages_apps` over the organization as
 * `GET /orgs/{org}` answers it: a member or above who holds
 * `MANAGE_APPLICATION` on `team` (a team they lead, or their row's
 * capabilities there) or, with no team, organization-wide.
 */
export function managesApps(org: unknown, account: string, team: string | null): boolean {
  const o = rec(org);
  const role = str(rec(o.members)[account]);
  if (role === null || (ROLE_RANK[role] ?? -1) < ROLE_RANK.member!) return false;
  const admin = (ROLE_RANK[role] ?? 0) >= ROLE_RANK.admin!;
  const orgCaps = (): number => {
    if (admin) return ALL;
    const own = rec(o.capabilities)[account];
    if (typeof own === "number") return own;
    return typeof o.defaultCapabilities === "number" ? o.defaultCapabilities : 0;
  };
  const cap = ORG_CAPABILITIES.MANAGE_APPLICATION;
  if (team === null) return (orgCaps() & cap) !== 0;
  if (admin) return true;
  const teams = rec(o.teams);
  // A team they lead, or one above it.
  let cur: string | null = team;
  for (let hops = 0; cur !== null && hops <= 32; hops++) {
    const t = rec(teams[cur]);
    if (Object.keys(t).length === 0) break;
    if (rec(t.members)[account] === true) return true;
    cur = str(t.parent);
  }
  const row = rec(rec(teams[team]).capabilities)[account];
  return ((typeof row === "number" ? row : orgCaps()) & cap) !== 0;
}

function accountOf(client: UpgradeClient, accountId?: string): string | null {
  return accountId ?? client.session?.accountId ?? null;
}

/** Core's `latestBlocked`, when the entry carries one that reads. */
function blockedIn(entry: ReportedApp): UpgradeBlocked | null {
  const b = rec((entry as { latestBlocked?: unknown }).latestBlocked);
  const version = str(b.version);
  if (!version) return null;
  return { version, reason: str(b.reason) ?? "unknown", message: str(b.message) ?? "" };
}

/** The offer an entry of a report makes, before asking whether this account may take it. */
function offerIn(entry: ReportedApp, report: AppsReport): Omit<UpgradeOffer, "canUpgrade"> | null {
  const current = entry.package?.version;
  const available = entry.availableVersions ?? [];
  const newest = available[available.length - 1];
  if (!current || !newest || compareVersions(newest, current) <= 0) return null;
  // Absent from a node before core named it: the newest, as before.
  const named = (entry as { latestReachable?: unknown }).latestReachable;
  const reach = named === undefined ? newest : str(named);
  const target = reach !== null && compareVersions(reach, current) > 0 ? reach : null;
  const reachable = target !== null;
  const latest = target ?? newest;
  const blocked = blockedIn(entry);
  // `publisher` is on the wire though mero-js's type says `owner | operator`.
  const said = entry.upgradesHeldBy as string;
  const heldBy: UpgradeHolder | null =
    report.governance?.appUpgrades === "operator" || said === "operator"
      ? "operator"
      : said === "owner" || said === "publisher"
        ? said
        : null;
  if (heldBy === null) return null;
  return { app: entry.app, name: entry.name ?? null, current, latest, reachable, blocked, heldBy };
}

/**
 * Whether `account` may upgrade the instance `entry` names, judged as core's
 * `may_upgrade` judges an owner-held one. `role` is the account's role in the
 * entry's organization when already known (`GET /auth/me`). Any read that
 * fails answers `false`.
 */
async function mayUpgrade(
  client: UpgradeClient,
  entry: ReportedApp,
  account: string,
  orgs: Map<string, Promise<unknown>>,
  role?: string | null,
): Promise<boolean> {
  try {
    // An account's report lists its own apps only (core's `scope_report`:
    // outside any organization and owned by the account).
    if (entry.scope.kind === "account") return true;
    const orgId = entry.scope.org;
    const team = entry.team ?? null;
    // Owners and admins hold every capability, on every team.
    if (role && (ROLE_RANK[role] ?? 0) >= ROLE_RANK.admin!) return true;
    let org = orgs.get(orgId);
    if (!org) {
      org = client.orgs.get({ org: orgId }).catch(() => null);
      orgs.set(orgId, org);
    }
    if (managesApps(await org, account, team)) return true;
    // The instance's own owner (a member who created it).
    const app = rec(await client.apps.get({ app: entry.app }));
    return str(app.owner) === account;
  } catch {
    return false;
  }
}

/**
 * The newer release `appId` may move to, or `null` when there is none (up to
 * date, a development bundle, or no report that names it). `canUpgrade` says
 * whether this account may approve it.
 */
export async function upgradeOffer(
  client: UpgradeClient,
  appId: string,
  options: { accountId?: string } = {},
): Promise<UpgradeOffer | null> {
  const account = accountOf(client, options.accountId);
  try {
    const app = rec(await client.apps.get({ app: appId }));
    const report = await client.appsReportAll(str(app.org));
    const entry = report.apps.find((a) => a.app === appId);
    const offer = entry ? offerIn(entry, report) : null;
    if (!entry || !offer) return null;
    const canUpgrade = offer.heldBy === "owner" && account !== null && (await mayUpgrade(client, entry, account, new Map()));
    return { ...offer, canUpgrade };
  } catch {
    return null;
  }
}

/**
 * Every instance of `package` this account reaches that has a newer release:
 * its own apps and each organization's it belongs to, one report each.
 */
export async function upgradeOffers(
  client: UpgradeClient,
  options: { package: string; accountId?: string },
): Promise<UpgradeOffer[]> {
  const me = rec(await client.auth.me());
  const account = accountOf(client, options.accountId) ?? str(me.accountId);
  const roles = new Map<string, string | null>();
  for (const o of Array.isArray(me.orgs) ? me.orgs : []) {
    const id = str(rec(o).orgId);
    if (id) roles.set(id, str(rec(o).role));
  }
  const reports = await Promise.all(
    [null, ...roles.keys()].map((scope) => client.appsReportAll(scope).catch(() => null)),
  );
  const orgs = new Map<string, Promise<unknown>>();
  const offers: UpgradeOffer[] = [];
  for (const report of reports) {
    for (const entry of report?.apps ?? []) {
      if (entry.package?.package !== options.package) continue;
      const offer = offerIn(entry, report!);
      if (!offer) continue;
      const role = entry.scope.kind === "org" ? roles.get(entry.scope.org) : null;
      const canUpgrade =
        offer.heldBy === "owner" && account !== null && (await mayUpgrade(client, entry, account, orgs, role));
      offers.push({ ...offer, canUpgrade });
    }
  }
  return offers;
}

// ---------------------------------------------------------------- remembered

const DISMISSED_PREFIX = "cp-upgrade:dismissed:";
/** The upgrade this browser sent to the consent page, until it comes back. */
export const UPGRADE_PENDING_KEY = "cp-upgrade:pending";
/** A consent request lives 10 minutes on the node; a pending one older than this is stale. */
const PENDING_TTL_MS = 30 * 60 * 1000;

function defaultStorage(): KeyValueStorage | undefined {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    return undefined;
  }
}

/** "Not now" for this instance and this version: the prompt stays away until a newer one. */
export function dismissUpgrade(storage: KeyValueStorage | undefined, app: string, version: string): void {
  try {
    storage?.setItem(`${DISMISSED_PREFIX}${app}:${version}`, "1");
  } catch {
    /* blocked storage: hidden for this page only */
  }
}

export function upgradeDismissed(storage: KeyValueStorage | undefined, app: string, version: string): boolean {
  try {
    return storage?.getItem(`${DISMISSED_PREFIX}${app}:${version}`) === "1";
  } catch {
    return false;
  }
}

interface PendingUpgrade {
  requestId: string;
  app: string;
  version: string;
  from?: string;
  at: number;
}

function readPending(storage: KeyValueStorage | undefined): PendingUpgrade | null {
  try {
    const raw = storage?.getItem(UPGRADE_PENDING_KEY);
    const p = rec(raw ? JSON.parse(raw) : null);
    const requestId = str(p.requestId);
    const app = str(p.app);
    const version = str(p.version);
    if (!requestId || !app || !version) return null;
    const at = typeof p.at === "number" ? p.at : 0;
    return { requestId, app, version, ...(str(p.from) ? { from: str(p.from)! } : {}), at };
  } catch {
    return null;
  }
}

function forgetPending(storage: KeyValueStorage | undefined): void {
  try {
    storage?.removeItem(UPGRADE_PENDING_KEY);
  } catch {
    /* nothing to forget */
  }
}

/** An approved upgrade whose new frontend is loading, said on the page that loads. */
const UPDATED_KEY = "cp-upgrade:updated";

function rememberUpdated(storage: KeyValueStorage | undefined, app: string, version: string): void {
  try {
    storage?.setItem(UPDATED_KEY, JSON.stringify({ app, version, at: Date.now() }));
  } catch {
    /* the new page then says nothing */
  }
}

/** The approved upgrade this page is the new frontend of, once: the release it was approved for, served here. */
function takeUpdated(storage: KeyValueStorage | undefined, href: string): { app: string; version: string } | null {
  try {
    const raw = storage?.getItem(UPDATED_KEY);
    if (!raw) return null;
    storage?.removeItem(UPDATED_KEY);
    const p = rec(JSON.parse(raw));
    const app = str(p.app);
    const version = str(p.version);
    const at = typeof p.at === "number" ? p.at : 0;
    if (!app || !version || Date.now() - at > PENDING_TTL_MS || servedRelease(href) !== version) return null;
    return { app, version };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the consent round trip

/**
 * Where the consent page sends the person back: this page, without a
 * fragment (core refuses one) and without a previous consent's
 * `request_id`/`result`.
 */
export function upgradeReturnTo(href: string): string {
  const url = new URL(href);
  url.hash = "";
  url.searchParams.delete("request_id");
  url.searchParams.delete("result");
  return url.toString();
}

export interface StartUpgradeOptions {
  /** Sends the browser to the consent page; by default `location.assign`. */
  navigate?: (url: string) => void;
  /** Where the request is remembered until the page sends the person back. */
  storage?: KeyValueStorage;
  /** The release the instance runs now, said again on the way back. */
  from?: string;
}

/**
 * Ask the node for the consent request that upgrades `appId` to `version`,
 * remember it, and send the person to the node's consent page, which sends
 * them back to `returnTo`. Throws (and does not navigate) when the node
 * refuses, or answers a code that is not its request's.
 */
export async function startUpgrade(
  client: ClientRoutes<{ consent: "pageCreate" }>,
  appId: string,
  version: string,
  returnTo: string,
  options: StartUpgradeOptions = {},
): Promise<void> {
  const started = await client.consent.pageCreate({ body: upgradeConsent(appId, version, returnTo) });
  if (started.code && globalThis.crypto?.subtle && started.code !== (await confirmationCode(started.requestId))) {
    throw new Error("The node's answer did not match its request; nothing was opened.");
  }
  const storage = options.storage ?? defaultStorage();
  try {
    const pending: PendingUpgrade = {
      requestId: started.requestId,
      app: appId,
      version,
      ...(options.from ? { from: options.from } : {}),
      at: Date.now(),
    };
    storage?.setItem(UPGRADE_PENDING_KEY, JSON.stringify(pending));
  } catch {
    /* the way back then says nothing; the upgrade itself is the node's */
  }
  (options.navigate ?? ((url: string) => globalThis.location.assign(url)))(started.url);
}

/** What came of an upgrade sent to the consent page. */
export interface UpgradeReturn {
  /** As the node says (`GET /consent/{id}/result`); `unknown` when it could not be read. */
  status: "approved" | "declined" | "pending" | "unknown";
  app: string;
  version: string;
  from: string | null;
  /** This page's URL without the consent page's parameters. */
  href: string;
}

/**
 * The person is back from the consent page (`?request_id=…&result=…`) for the
 * upgrade {@link startUpgrade} remembered: the node's decision, confirmed
 * with `GET /consent/{id}/result` (the URL is only a hint). `null` for any
 * other page, including a consent this module did not start.
 */
export async function finishUpgrade(
  client: ClientRoutes<{ consent: "pageResult" }>,
  href: string,
  storage: KeyValueStorage | undefined = defaultStorage(),
): Promise<UpgradeReturn | null> {
  let back: ReturnType<typeof consentReturn>;
  try {
    back = consentReturn(href);
  } catch {
    return null;
  }
  if (!back) return null;
  const pending = readPending(storage);
  if (!pending || pending.requestId !== back.requestId) return null;
  forgetPending(storage);
  let status: UpgradeReturn["status"] = "unknown";
  if (Date.now() - pending.at < PENDING_TTL_MS) {
    try {
      status = (await client.consent.pageResult({ request: back.requestId })).status;
    } catch {
      status = "unknown";
    }
  }
  return { status, app: pending.app, version: pending.version, from: pending.from ?? null, href: upgradeReturnTo(href) };
}

// ---------------------------------------------------------------- the prompt

export interface UpgradePromptHandlers {
  /** The app's name, as the prompt says it ("KV Store"). */
  appName: string;
  /** Say which instance (its name), when the account has several to upgrade. */
  showInstance?: boolean;
  onUpdate(): void;
  onLater(): void;
}

/** Why a release is out of reach, in a clause. */
function blockedCopy(b: UpgradeBlocked): string {
  switch (b.reason) {
    case "runtime":
      return "the servers that hold this app run an older Calimero release than it needs";
    case "authority":
      return "its publisher would take over its updates";
    default:
      return b.message || "the node does not take it";
  }
}

/**
 * "Version 1.2.0 of KV Store is available (you run 1.0.0)." When a newer one
 * is out of reach, why; when none is reachable, that it cannot be installed yet.
 */
export function upgradeCopy(offer: UpgradeOffer, appName: string, showInstance = false): string {
  const which = showInstance && offer.name ? ` for “${offer.name}”` : "";
  if (!offer.reachable) {
    const why = offer.blocked ? `: ${blockedCopy(offer.blocked)}` : "";
    return `Version ${offer.latest} of ${appName} is out${which} (you run ${offer.current}), but it cannot be installed yet${why}.`;
  }
  const said = `Version ${offer.latest} of ${appName} is available${which} (you run ${offer.current}).`;
  const b = offer.blocked;
  if (!b || b.version === offer.latest) return said;
  return `${said} Version ${b.version} cannot be installed yet: ${blockedCopy(b)}.`;
}

/**
 * The version "Not now" is remembered for: the release offered, or, for an
 * offer that cannot be taken yet, that release as not reachable, so the
 * prompt comes back once it can be.
 */
function dismissedAs(offer: UpgradeOffer): string {
  return offer.reachable ? offer.latest : `unreachable:${offer.latest}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string, testId?: string) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  if (testId) node.dataset.testid = testId;
  return node;
}

/**
 * The prompt: one line and two buttons, in a small card fixed to the
 * bottom corner of the page (`passkey.css`, `cp-upgrade`), never over the
 * app's controls' focus and never modal. Appended to `container`; returns it.
 */
export function renderUpgradePrompt(container: HTMLElement, offer: UpgradeOffer, handlers: UpgradePromptHandlers): HTMLElement {
  const root = el("aside", "cp-upgrade", undefined, "upgrade-prompt");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", offer.reachable ? "Update available" : "Update not possible yet");
  root.append(el("p", "cp-upgrade__text", upgradeCopy(offer, handlers.appName, handlers.showInstance)));
  const actions = el("div", "cp-upgrade__actions");
  // An offer that cannot be taken yet only explains: there is nothing to approve.
  if (offer.reachable) {
    const update = el("button", "cp-upgrade__primary", "Update", "upgrade-update");
    update.type = "button";
    update.addEventListener("click", () => handlers.onUpdate());
    actions.append(update);
  }
  const later = el("button", "cp-upgrade__link", offer.reachable ? "Not now" : "OK", "upgrade-later");
  later.type = "button";
  later.addEventListener("click", () => handlers.onLater());
  actions.append(later);
  root.append(actions);
  container.append(root);
  return root;
}

/** The word on what came back from the consent page, with an optional action. */
function renderNotice(
  container: HTMLElement,
  text: string,
  action: { label: string; run(): void } | null,
  onClose: () => void,
): HTMLElement {
  const root = el("aside", "cp-upgrade", undefined, "upgrade-notice");
  root.setAttribute("role", "status");
  root.append(el("p", "cp-upgrade__text", text));
  const actions = el("div", "cp-upgrade__actions");
  if (action) {
    const go = el("button", "cp-upgrade__primary", action.label, "upgrade-reload");
    go.type = "button";
    go.addEventListener("click", () => action.run());
    actions.append(go);
  }
  const close = el("button", "cp-upgrade__link", "Close", "upgrade-close");
  close.type = "button";
  close.addEventListener("click", onClose);
  actions.append(close);
  root.append(actions);
  container.append(root);
  return root;
}

/** "KV Store" from a page title such as "KV Store — Calimero" or "Mero Chat | Private P2P Chat". */
export function appNameFromTitle(title: string | undefined): string | null {
  const name = (title ?? "").split(/\s[—|–-]\s/)[0]?.trim();
  return name ? name : null;
}

export interface WatchUpgradesOptions {
  client: UpgradeClient;
  /** The app's package: only its instances are offered. */
  package: string;
  /** The app's name in the prompt; by default the page title's first part. */
  appName?: string;
  /** The signed-in account; by default the client's session's. */
  accountId?: string;
  storage?: KeyValueStorage;
  /** Where the prompt goes; `document.body` by default. */
  container?: HTMLElement;
  /** This page's URL; `location.href` by default. */
  href?: string;
  navigate?: (url: string) => void;
  /** Drops the consent page's parameters from the address bar; `history.replaceState` by default. */
  replaceUrl?: (url: string) => void;
}

/** Whether a prompt or notice for `pkg` is on the page already: one per package, however many watchers. */
function shownFor(pkg: string): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-upgrade-package]")).some(
    (n) => n.dataset.upgradePackage === pkg,
  );
}
/** One check per client, account and package for the page's life (no polling). */
const checks = new WeakMap<object, Map<string, Promise<UpgradeOffer[]>>>();

function checkOnce(client: UpgradeClient, pkg: string, accountId?: string): Promise<UpgradeOffer[]> {
  let byClient = checks.get(client);
  if (!byClient) {
    byClient = new Map();
    checks.set(client, byClient);
  }
  const key = `${pkg}\0${accountId ?? client.session?.accountId ?? ""}`;
  let check = byClient.get(key);
  if (!check) {
    check = upgradeOffers(client, { package: pkg, ...(accountId ? { accountId } : {}) }).catch(() => []);
    byClient.set(key, check);
  }
  return check;
}

/**
 * For a signed-in session: once, say what came back from an upgrade's consent
 * page if the person is just back from one, and otherwise offer the newest
 * release one instance of `package` this account may upgrade can reach,
 * unless "Not now" was said to that version, or, when none can be reached
 * yet, say why. Shows nothing to anyone who may not
 * upgrade, nothing for publisher- or operator-held upgrades, and nothing when
 * a read fails. Returns the function that takes it away (sign-out, unmount).
 */
export function watchUpgrades(options: WatchUpgradesOptions): () => void {
  const { client, package: pkg } = options;
  if (typeof document === "undefined") return () => {};
  let live = true;
  let shown: HTMLElement | null = null;
  const storage = options.storage ?? defaultStorage();
  const container = options.container ?? document.body;
  const href = () => options.href ?? globalThis.location.href;
  const navigate = options.navigate ?? ((url: string) => globalThis.location.assign(url));
  const replaceUrl =
    options.replaceUrl ??
    ((url: string) => {
      try {
        globalThis.history.replaceState(globalThis.history.state, "", url);
      } catch {
        /* the parameters stay in the address bar */
      }
    });
  const appName = () => options.appName ?? appNameFromTitle(globalThis.document?.title) ?? "this app";
  const take = () => {
    shown?.remove();
    shown = null;
  };

  const show = (offer: UpgradeOffer, several: boolean) => {
    const prompt = renderUpgradePrompt(container, offer, {
      appName: appName(),
      showInstance: several,
      onLater: () => {
        dismissUpgrade(storage, offer.app, dismissedAs(offer));
        take();
      },
      onUpdate: () => {
        const update = prompt.querySelector<HTMLButtonElement>("[data-testid=upgrade-update]")!;
        prompt.querySelector("[data-testid=upgrade-error]")?.remove();
        update.disabled = true;
        update.textContent = "Opening the approval page…";
        startUpgrade(client, offer.app, offer.latest, upgradeReturnTo(href()), {
          navigate,
          ...(storage ? { storage } : {}),
          from: offer.current,
        }).catch((e: unknown) => {
          update.disabled = false;
          update.textContent = "Update";
          const error = el("p", "cp-upgrade__error", `Could not start the update: ${describeError(e)}`, "upgrade-error");
          error.setAttribute("role", "alert");
          prompt.append(error);
        });
      },
    });
    prompt.dataset.upgradePackage = pkg;
    shown = prompt;
  };

  void (async () => {
    try {
      const back = await finishUpgrade(client, href(), storage);
      if (!live) return;
      if (back) {
        replaceUrl(back.href);
        let text: string;
        let action: { label: string; run(): void } | null = null;
        if (back.status === "approved") {
          // The node ran the upgrade when the person approved; the report says whether it took.
          const now = await upgradeOffer(client, back.app, options.accountId ? { accountId: options.accountId } : {});
          if (!live) return;
          if (now && compareVersions(now.current, back.version) < 0) {
            text = `The update was approved, but ${appName()} still runs version ${now.current}.`;
          } else {
            // This page is the old release's frontend: load the one the instance
            // runs now, in the same place, and say so there.
            const served = servedRelease(back.href);
            const there = instanceReleaseUrl(back.href, back.app);
            if (there && served !== back.version) {
              rememberUpdated(storage, back.app, back.version);
              navigate(there);
              return;
            }
            text = `${appName()} is updated to version ${back.version}.`;
            if (served === null) {
              text += " Reload to use it.";
              action = { label: "Reload", run: () => navigate(back.href) };
            }
          }
        } else if (back.status === "declined") {
          text = `The update to version ${back.version} was not approved.`;
        } else {
          text = `The update to version ${back.version} was not finished.`;
        }
        if (shownFor(pkg)) return;
        shown = renderNotice(container, text, action, take);
        shown.dataset.upgradePackage = pkg;
        return;
      }
      const updated = takeUpdated(storage, href());
      if (updated) {
        if (shownFor(pkg)) return;
        shown = renderNotice(container, `${appName()} is updated to version ${updated.version}.`, null, take);
        shown.dataset.upgradePackage = pkg;
        return;
      }
      const offers = (await checkOnce(client, pkg, options.accountId)).filter(
        (o) => o.canUpgrade && o.heldBy === "owner",
      );
      if (!live) return;
      // One that can be taken first; else one that explains why none can.
      const open = offers.filter((o) => !upgradeDismissed(storage, o.app, dismissedAs(o)));
      const offer = open.find((o) => o.reachable) ?? open[0];
      if (offer && !shownFor(pkg)) show(offer, offers.length > 1);
    } catch {
      // No offer is better than a wrong one.
    }
  })();

  return () => {
    live = false;
    take();
  };
}
