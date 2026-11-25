/**
 * Where a component app's frontend connects: the three `merod local` nodes in
 * development; in production a Calimero Cloud cluster (by name, through the
 * cloud's node directory) or an attested node the operator runs (by URL).
 * Decided from the build's environment only, once, when the service starts:
 * the person signing in never picks a target, and a production build can never
 * trust a mock quote.
 */

import {
  CLOUD_ENVIRONMENTS,
  DEFAULT_DIRECTORY,
  cloudEnvironment,
  pageDeployment,
  type CloudEnvironment,
  type FrontendManifest,
  type NodePolicy,
} from "@calimero-network/mero-js";

import { cloudLinks } from "./cloud";
import type { KeyValueStorage } from "./client";

/** Where the tab keeps the deployment its page was opened for ({@link pageOffer}). */
export const DEPLOYMENT_KEY = "cp-deployment";

/** The nodes `merod local` starts: node i listens on 2500 + i. */
export const LOCAL_NODES: readonly string[] = [
  "http://127.0.0.1:2501",
  "http://127.0.0.1:2502",
  "http://127.0.0.1:2503",
];

export type Target =
  | {
      kind: "local";
      /** The cluster's nodes, the first tried first. */
      nodes: string[];
    }
  | {
      kind: "cloud";
      /**
       * The cluster's name in the node directory, e.g. `eu-shared-1`. For a
       * node reached directly (`VITE_CALIMERO_TARGET=node`) it is the first
       * node's host: there is no directory, and `nodes` is always set.
       */
      cluster: string;
      /** Reached by URL (`VITE_CALIMERO_TARGET=node`), not through a directory. */
      direct?: true;
      /** Try the nodes in this zone first. */
      zone?: string;
      /** Another node directory than mero-js's default (staging). */
      directory?: string;
      /** The lowest mero-tee release a node may run. */
      minReleaseVersion: string;
      /**
       * Which Calimero Cloud the cluster is in, when it is not production: from
       * the served page's hostname ({@link cloudEnvironment}), or from the build
       * (`VITE_CALIMERO_ENV`). Never from anything a server answers.
       */
      environment?: "staging";
      /**
       * The cluster's API URLs when the page already knows them (it is served by
       * the cluster: {@link servedNodes}); otherwise the node directory is asked.
       */
      nodes?: string[];
    };

/**
 * The variables `resolveTarget` reads: Vite's `import.meta.env` as is.
 *
 * - `VITE_CALIMERO_TARGET` `local` | `cloud` | `node`: overrides the mode (a
 *   production build against `merod local`, a dev server against the cloud, or
 *   an attested node the operator runs, reached by URL).
 * - `VITE_CALIMERO_NODES`: comma-separated node URLs for `local` (default
 *   {@link LOCAL_NODES}) and `node` (required).
 * - `VITE_CALIMERO_CLUSTER`, `VITE_CALIMERO_ZONE`, `VITE_CALIMERO_DIRECTORY`,
 *   `VITE_CALIMERO_MIN_RELEASE`: the cloud cluster and its trust floor.
 * - `VITE_CALIMERO_ENV` `production` (default) | `staging`: which Calimero Cloud
 *   a build that is not served by a cluster (Vercel, a dev server) reaches;
 *   `staging` asks staging's directory and trusts its debug node images. A
 *   page a cluster serves reads it from its own hostname instead. It also
 *   picks the console, deploy page, apps domain and registry every build links
 *   to ({@link cloudLinks}), served or not; a staging bundle is built with it
 *   (scripts/frontend-target.sh).
 */
export interface ConnectEnv {
  DEV?: boolean;
  VITE_CALIMERO_TARGET?: string;
  VITE_CALIMERO_NODES?: string;
  VITE_CALIMERO_CLUSTER?: string;
  VITE_CALIMERO_ZONE?: string;
  VITE_CALIMERO_DIRECTORY?: string;
  VITE_CALIMERO_MIN_RELEASE?: string;
  VITE_CALIMERO_ENV?: string;
  VITE_CALIMERO_BUNDLE?: string;
  VITE_CALIMERO_PACKAGE?: string;
  VITE_CALIMERO_VERSION?: string;
  [key: string]: unknown;
}

/** A build configured so that it cannot connect anywhere. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function urls(list: string): string[] {
  const nodes = list
    .split(",")
    .map((u) => u.trim().replace(/\/+$/, ""))
    .filter((u) => u !== "");
  for (const node of nodes) {
    let parsed: URL;
    try {
      parsed = new URL(node);
    } catch {
      throw new ConfigError(`VITE_CALIMERO_NODES: ${JSON.stringify(node)} is not a URL`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ConfigError(`VITE_CALIMERO_NODES: ${node} is not an http(s) URL`);
    }
  }
  return nodes;
}

/**
 * A production build with no cluster, on a page no cluster serves: a static
 * copy of the app (its listing page), not the app. A Cloud node trusts passkey
 * ceremonies only from the frontends it serves, so the app is opened from the
 * console, at the cluster's own copy: the console of the Calimero Cloud the
 * build names (`VITE_CALIMERO_ENV`, {@link cloudLinks}).
 */
export class NotServedError extends ConfigError {
  constructor(
    readonly app?: string,
    reason = "VITE_CALIMERO_CLUSTER is not set and no Calimero Cloud cluster serves this page",
    /** Where to open the app: the build's Calimero Cloud console. */
    readonly console: string = cloudLinks().console,
  ) {
    super(
      `This is ${app ? `${app}'s` : "the app's"} listing page; open the app from Calimero Cloud: ${console}` +
        ` (${reason})`,
    );
    this.name = "NotServedError";
  }
}

function targetKind(env: ConnectEnv): "local" | "cloud" | "node" {
  const asked = text(env.VITE_CALIMERO_TARGET);
  if (asked !== undefined && asked !== "local" && asked !== "cloud" && asked !== "node") {
    throw new ConfigError(`VITE_CALIMERO_TARGET is ${JSON.stringify(asked)}; use "local", "cloud" or "node"`);
  }
  return asked ?? (env.DEV ? "local" : "cloud");
}

/** The Calimero Cloud the build names (`VITE_CALIMERO_ENV`), `production` when it names none. */
function buildEnvironment(env: ConnectEnv): CloudEnvironment {
  const asked = text(env.VITE_CALIMERO_ENV);
  if (asked === undefined) return "production";
  if (asked !== "production" && asked !== "staging") {
    throw new ConfigError(`VITE_CALIMERO_ENV is ${JSON.stringify(asked)}; use "production" or "staging"`);
  }
  return asked;
}

/**
 * The node directory to ask: `VITE_CALIMERO_DIRECTORY`, else the environment's
 * (`undefined` for production, which is mero-js's default).
 */
function directoryFor(env: ConnectEnv, environment: CloudEnvironment): string | undefined {
  return text(env.VITE_CALIMERO_DIRECTORY) ?? (environment === "staging" ? CLOUD_ENVIRONMENTS.staging.directory : undefined);
}

function minRelease(env: ConnectEnv): string {
  const minReleaseVersion = text(env.VITE_CALIMERO_MIN_RELEASE);
  if (!minReleaseVersion) {
    throw new ConfigError(
      "VITE_CALIMERO_MIN_RELEASE is not set: the lowest mero-tee release a cloud node may run",
    );
  }
  return minReleaseVersion;
}

/**
 * Local nodes in development (`DEV`), the cloud cluster otherwise. Synchronous
 * and from the build's environment alone, so a production build must name its
 * cluster here; the app's session code uses {@link connectTarget}, which also
 * connects a page the cluster serves without one.
 */
export function resolveTarget(env: ConnectEnv): Target {
  const kind = targetKind(env);
  if (kind === "local") {
    const given = text(env.VITE_CALIMERO_NODES);
    const nodes = given ? urls(given) : [...LOCAL_NODES];
    if (nodes.length === 0) throw new ConfigError("VITE_CALIMERO_NODES names no node");
    return { kind, nodes };
  }
  if (kind === "node") {
    const given = text(env.VITE_CALIMERO_NODES);
    const nodes = given ? urls(given) : [];
    const first = nodes[0];
    if (!first) {
      throw new ConfigError("VITE_CALIMERO_NODES is not set: a node target connects to the node URLs it names");
    }
    for (const node of nodes) {
      if (new URL(node).protocol !== "https:") {
        throw new ConfigError(`VITE_CALIMERO_NODES: ${node} is not https: an attested node is reached over TLS`);
      }
    }
    const minReleaseVersion = text(env.VITE_CALIMERO_MIN_RELEASE);
    if (!minReleaseVersion) {
      throw new ConfigError(
        "VITE_CALIMERO_MIN_RELEASE is not set: the lowest mero-tee release the node may run",
      );
    }
    return { kind: "cloud", cluster: new URL(first).host, direct: true, nodes, minReleaseVersion };
  }
  const cluster = text(env.VITE_CALIMERO_CLUSTER);
  if (!cluster) {
    throw new ConfigError(
      "VITE_CALIMERO_CLUSTER is not set: a production build connects to a Calimero Cloud cluster by name",
    );
  }
  const minReleaseVersion = minRelease(env);
  const environment = buildEnvironment(env);
  const zone = text(env.VITE_CALIMERO_ZONE);
  const directory = directoryFor(env, environment);
  return {
    kind,
    cluster,
    minReleaseVersion,
    ...(zone ? { zone } : {}),
    ...(directory ? { directory } : {}),
    ...(environment === "staging" ? { environment } : {}),
  };
}

/**
 * What every node must attest to. Mock quotes (what `merod local` sends) pass
 * for a local target only; a cloud node must run a signed mero-tee release at
 * or above the floor. On staging, whose clusters run debug images too, that is
 * any of its image profiles (mero-js's `CLOUD_ENVIRONMENTS.staging.trust`): the
 * node's own, whose signed image its quote must still be. Production trusts
 * `locked-read-only` alone.
 */
export function policyFor(target: Target): NodePolicy {
  if (target.kind === "local") return { allowMock: true };
  const trust = target.environment === "staging" ? CLOUD_ENVIRONMENTS.staging.trust : {};
  return { release: { minReleaseVersion: target.minReleaseVersion, ...trust } };
}

/** A stable name for the target, for keying what is stored per cluster. */
export function targetKey(target: Target): string {
  if (target.kind === "local") return `local:${target.nodes.join(",")}`;
  return target.direct ? `node:${(target.nodes ?? []).join(",")}` : `cloud:${target.cluster}`;
}

/** What `createApp` makes an instance from. */
export type AppSource = string | { package: string; version?: string };

/**
 * A raw bundle hash in development (`VITE_CALIMERO_BUNDLE`, written by
 * `pnpm dev:local`), else a package release from the registry:
 * `VITE_CALIMERO_PACKAGE` (default `defaultPackage`) at `VITE_CALIMERO_VERSION`
 * (default: the newest the cluster has).
 */
export function appSource(env: ConnectEnv, defaultPackage: string): AppSource {
  const bundle = text(env.VITE_CALIMERO_BUNDLE);
  if (bundle) return bundle;
  const version = text(env.VITE_CALIMERO_VERSION);
  return {
    package: text(env.VITE_CALIMERO_PACKAGE) ?? defaultPackage,
    ...(version ? { version } : {}),
  };
}

/** A deployment offering the app's package: new instances are created from it, at its version. */
export interface Offer {
  id: string;
  /** The release it offers, when the served manifest lists it. */
  version?: string;
}

/** The manifest {@link servedNodes} last read: where {@link pageOffer} finds the cluster's offers. */
let servedManifest: FrontendManifest | null = null;

/**
 * The deployment new instances of `pkg` are created from: the page's
 * `?deployment=` (the console opens `/d/{id}/`, which redirects there), kept in
 * the tab so in-app navigation and reloads keep it; else the served manifest's
 * own deployment (a deployment's host); else the package's only offer. `null`
 * without one: development, an open cluster, a page no cluster serves.
 */
export function pageOffer(
  pkg: string,
  href: string | undefined = globalThis.location?.href,
  storage: KeyValueStorage | null = sessionStore(),
  manifest: FrontendManifest | null = servedManifest,
): Offer | null {
  const listed = manifest?.package === pkg ? manifest : null;
  const only = listed?.deployments.length === 1 ? listed.deployments[0]?.id : null;
  const opened = openedDeployment(href, storage);
  // On a served page, a link's deployment counts only if this cluster offers the package from it.
  const linked = manifest && !listed?.deployments.some((d) => d.id === opened) ? null : opened;
  const id = linked ?? listed?.deployment ?? only;
  if (!id) return null;
  const version = listed?.deployments.find((d) => d.id === id)?.version;
  return version ? { id, version } : { id };
}

/** The tab's `sessionStorage`; `null` where it is blocked. */
export function sessionStore(): KeyValueStorage | null {
  try {
    return (globalThis as { sessionStorage?: KeyValueStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

function openedDeployment(href: string | undefined, storage: KeyValueStorage | null): string | null {
  const asked = href ? pageDeployment(href) : null;
  try {
    if (asked) storage?.setItem(DEPLOYMENT_KEY, asked);
    return asked ?? storage?.getItem(DEPLOYMENT_KEY) ?? null;
  } catch {
    return asked;
  }
}

// Read at load, before an app's router can drop the query.
openedDeployment(globalThis.location?.href, sessionStore());

/**
 * The cluster's API URLs when this page is a frontend the cluster serves from
 * the app's bundle (`{label}.{apps_domain}`): the node publishes them at
 * `/.well-known/calimero.json`, and the page's CSP lets it connect to those and
 * nothing else, so the node directory is neither needed nor reachable there.
 * `null` anywhere else (the dev server, a static host, no such file). Keeps the
 * manifest for {@link pageOffer}.
 */
export async function servedNodes(
  origin: string | undefined = globalThis.location?.origin,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<string[] | null> {
  servedManifest = null;
  if (!origin || !/^https?:/.test(origin)) return null;
  try {
    const response = await fetcher(new URL("/.well-known/calimero.json", origin).toString(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<FrontendManifest> | null;
    servedManifest = manifestOf(body);
    const api = body?.api as unknown;
    if (!Array.isArray(api)) return null;
    const nodes = api.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    return nodes.length > 0 ? nodes : null;
  } catch {
    return null;
  }
}

/** `body` as a served manifest, keeping only the offers that name an id. */
function manifestOf(body: Partial<FrontendManifest> | null): FrontendManifest | null {
  if (typeof body?.package !== "string") return null;
  const deployments = Array.isArray(body.deployments) ? body.deployments.filter((d) => typeof d?.id === "string" && d.id) : [];
  return { ...body, deployment: typeof body.deployment === "string" ? body.deployment : null, deployments } as FrontendManifest;
}

/** `target` with the served node list when it is a cloud target on a served page. */
export async function withServedNodes(
  target: Target,
  find: () => Promise<string[] | null> = () => servedNodes(),
  host: string | undefined = globalThis.location?.host,
): Promise<Target> {
  if (target.kind !== "cloud" || target.nodes) return target;
  const nodes = await find();
  if (!nodes) return target;
  // A served page trusts by its own hostname alone: the build's VITE_CALIMERO_ENV never widens it.
  const served: Target = { ...target, nodes };
  delete served.environment;
  return servedEnvironment(host) ? { ...served, environment: "staging" } : served;
}

/**
 * Whether a page a cluster serves is on staging, from its own hostname alone
 * (mero-js's {@link cloudEnvironment}): the browser checked that name over TLS,
 * and neither the build nor anything a server answers can change it. A page on
 * production's apps domain, a custom domain or an unknown host is not, so a
 * bundled frontend on production trusts `locked-read-only` only.
 */
function servedEnvironment(host: string | undefined): boolean {
  const given = text(host);
  if (!given) return false;
  try {
    return cloudEnvironment(new URL(`https://${given}`).hostname) === "staging";
  } catch {
    return false;
  }
}

export interface ConnectOptions {
  /** The cluster's node list when this page is served by it ({@link servedNodes}; fakes in tests). */
  servedNodes?: () => Promise<string[] | null>;
  /** The app's name, for the message a listing page shows. */
  app?: string;
  /**
   * The app's package id, to ask the directory where it runs when the build
   * names no cluster and no cluster serves the page (`VITE_CALIMERO_PACKAGE`
   * overrides it, as it does for {@link appSource}).
   */
  package?: string;
  /** This page's host: the served target's name (default `location.host`). */
  host?: string;
  /** Fetch for the directory's package lookup (tests). */
  fetch?: typeof fetch;
}

/** A node of a cluster in the directory's package answer. */
interface PackageNode {
  url: string;
  zone?: string;
  weight?: number;
}

/**
 * The primary cluster that runs `pkg`, from the directory's
 * `GET {directory}/package/{package}`, or `null` when no cluster does (404).
 * Its nodes come in the build's zone first, then heaviest first.
 */
async function packageCluster(
  directory: string,
  pkg: string,
  zone: string | undefined,
  fetcher: typeof fetch,
): Promise<{ cluster: string; nodes: string[] } | null> {
  const url = `${directory.replace(/\/+$/, "")}/package/${encodeURIComponent(pkg)}`;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new Error(`could not ask ${url} where ${pkg} runs: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url} answered ${response.status} asked where ${pkg} runs`);
  const body = (await response.json().catch(() => null)) as { clusters?: unknown } | null;
  const clusters = Array.isArray(body?.clusters) ? (body.clusters as Record<string, unknown>[]) : [];
  for (const entry of clusters) {
    if (entry?.primary !== true || typeof entry.cluster !== "string" || !Array.isArray(entry.nodes)) continue;
    const nodes = (entry.nodes as unknown[]).filter(
      (n): n is PackageNode =>
        typeof n === "object" && n !== null && typeof (n as PackageNode).url === "string" && /^https:\/\//.test((n as PackageNode).url),
    );
    if (nodes.length === 0) continue;
    const local = (n: PackageNode) => (zone !== undefined && n.zone === zone ? 0 : 1);
    const ordered = [...nodes].sort((a, b) => local(a) - local(b) || (b.weight ?? 0) - (a.weight ?? 0));
    return { cluster: entry.cluster, nodes: ordered.map((n) => n.url.replace(/\/+$/, "")) };
  }
  throw new Error(`${url} names no primary cluster with nodes for ${pkg}`);
}

/**
 * The target the app's session connects to: {@link resolveTarget} with the
 * served node list ({@link withServedNodes}) when the build names its cluster
 * (`VITE_CALIMERO_CLUSTER`, an override) or is not a cloud build. A cloud build
 * that names none connects to:
 *
 * 1. the cluster that serves this page: a frontend packed into a bundle is
 *    served by every cluster it is deployed to, at `{label}.{apps_domain}`,
 *    and keyed by the page's host, one per package and cluster;
 * 2. else the primary cluster that runs the app's package, from the directory
 *    (`GET {VITE_CALIMERO_DIRECTORY}/package/{package}`): a frontend the
 *    developer hosts;
 * 3. else nowhere: {@link NotServedError}, "open the app from Calimero Cloud".
 *
 * The attestation floor (`VITE_CALIMERO_MIN_RELEASE`) is required throughout.
 */
export async function connectTarget(env: ConnectEnv, options: ConnectOptions = {}): Promise<Target> {
  const find = options.servedNodes ?? (() => servedNodes());
  if (targetKind(env) !== "cloud" || text(env.VITE_CALIMERO_CLUSTER)) {
    return withServedNodes(resolveTarget(env), find, options.host ?? globalThis.location?.host);
  }
  const served = await find();
  if (served) {
    const minReleaseVersion = minRelease(env);
    const pageHost = text(options.host ?? globalThis.location?.host);
    const host = pageHost ?? new URL(served[0] as string).host;
    const onStaging = servedEnvironment(pageHost);
    return {
      kind: "cloud",
      cluster: host,
      nodes: served,
      minReleaseVersion,
      ...(onStaging ? { environment: "staging" as const } : {}),
    };
  }
  const minReleaseVersion = text(env.VITE_CALIMERO_MIN_RELEASE);
  const pkg = text(env.VITE_CALIMERO_PACKAGE) ?? text(options.package);
  if (!minReleaseVersion || !pkg) throw new NotServedError(options.app);
  const environment = buildEnvironment(env);
  const zone = text(env.VITE_CALIMERO_ZONE);
  const directory = directoryFor(env, environment);
  const found = await packageCluster(
    directory ?? DEFAULT_DIRECTORY,
    pkg,
    zone,
    options.fetch ?? ((input, init) => fetch(input, init)),
  );
  if (!found) throw new NotServedError(options.app, `no Calimero Cloud cluster runs ${pkg}`);
  return {
    kind: "cloud",
    cluster: found.cluster,
    nodes: found.nodes,
    minReleaseVersion,
    ...(zone ? { zone } : {}),
    ...(directory ? { directory } : {}),
    ...(environment === "staging" ? { environment } : {}),
  };
}
