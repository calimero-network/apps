/**
 * "Manage people in Calimero Home": where an org app sends the people who run
 * its organization, and when.
 *
 * Calimero Home (`apps/mero-home`, package {@link HOME_PACKAGE}) is one app on
 * the cluster like the others, served from its own origin. An app finds it the
 * way the cluster names every app's origin (`appHost`): this page's apps host
 * `{label}.{apps domain}` with Home's label in place of the app's, on the
 * cluster's own host (`app_host::cluster_label`) when the build names its
 * cluster. It links there only when the cluster has Home installed
 * (`GET /packages/{package}`, which a release the operator installs answers
 * to every account), so an app on a cluster without Home works on alone and
 * shows nothing. A dev server or a static host has no apps host: no link.
 *
 * Who gets the link ({@link showsHomeLink}): the org's owner and admins, who
 * run it there; and in a shared org (each app lists its own people) every
 * member, whose "who is in which app" lives in Home and not in any one app.
 */
import type { OrgMode } from "@calimero-network/mero-js";

import { appClusterLabel, appLabel } from "./appHost";
import type { Target } from "./target";
import type { ClientRoutes } from "./routes";

/** Calimero Home's package id (`apps/mero-home/logic/Cargo.toml`). */
export const HOME_PACKAGE = "com.calimero.mero-home";

/** The link's words, the same in every app. */
export const MANAGE_IN_HOME = "Manage people in Calimero Home →";

/** A node's app host: `{label}.{apps domain}`, the label 52 base32 characters. */
const APP_HOST = /^([a-z2-7]{52})\.(.+)$/;
/** A cluster's name in the node directory (`eu-shared-1`), not a host. */
const CLUSTER_NAME = /^[a-z0-9][a-z0-9-]*$/i;

/**
 * Where Home is served beside the page at `href`: `{scheme}//{home label}.{apps
 * domain}[:port]`, on cluster `cluster`'s own host when given. `null` when the
 * page is not on an apps host (a dev server, a static host, a custom domain).
 */
export function homeOrigin(href: string, cluster?: string | null, pkg: string = HOME_PACKAGE): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = APP_HOST.exec(url.hostname);
  if (!host) return null;
  const label = cluster ? appClusterLabel(cluster, pkg) : appLabel(pkg);
  return `${url.protocol}//${label}.${host[2]}${url.port ? `:${url.port}` : ""}`;
}

/**
 * The cluster's directory name when the session knows it (the build names its
 * cluster): Home on that cluster's own host. A page the cluster serves without
 * one knows only its host, so it gets Home's package host.
 */
export function clusterName(target: Target | null | undefined): string | null {
  if (!target || target.kind !== "cloud" || target.direct) return null;
  return CLUSTER_NAME.test(target.cluster) ? target.cluster : null;
}

/**
 * Home's page for `org`: `{origin}/{version}/?org={org}`. The release goes in
 * the path because the cluster's `/` redirects to `/{newest}/` without the
 * query; Home opens the org its `?org=` names. Without a release, its root.
 */
export function homeUrl(origin: string, version: string | null, org: string | null): string {
  const base = version ? `${origin}/${encodeURIComponent(version)}/` : `${origin}/`;
  return org ? `${base}?org=${encodeURIComponent(org)}` : base;
}

/** Where Home is for a session ({@link findHome}). */
export interface HomeLocation {
  origin: string;
  /** Home's newest release this account sees on the cluster. */
  version: string | null;
}

export interface FindHomeOptions {
  /** This page's URL; `location.href` by default. */
  href?: string;
  /** Home's package (tests). */
  package?: string;
}

const found = new WeakMap<object, Map<string, Promise<HomeLocation | null>>>();

/**
 * Calimero Home on this session's cluster, or `null`: the page is not on an
 * apps host, or the cluster does not have Home (`GET /packages/{home}` answers
 * nothing, or fails). Asked once per client: the answer is kept for the session.
 */
export function findHome(
  client: ClientRoutes<{ packages: "get" }>,
  target: Target | null | undefined,
  options: FindHomeOptions = {},
): Promise<HomeLocation | null> {
  const href = options.href ?? globalThis.location?.href ?? "";
  const pkg = options.package ?? HOME_PACKAGE;
  const origin = homeOrigin(href, clusterName(target), pkg);
  if (!origin) return Promise.resolve(null);
  let asks = found.get(client);
  if (!asks) found.set(client, (asks = new Map()));
  const key = `${origin} ${pkg}`;
  const known = asks.get(key);
  if (known) return known;
  const asked = client.packages.get({ package: pkg })
    .then((info): HomeLocation | null => {
      if (!info || info.package !== pkg) return null;
      const latest = typeof info.latest === "string" && info.latest ? info.latest : null;
      const versions = Array.isArray(info.versions) ? info.versions : [];
      const version = latest ?? versions[versions.length - 1]?.version ?? null;
      return version ? { origin, version } : null;
    })
    .catch(() => null);
  asks.set(key, asked);
  return asked;
}

/** The viewer's standing in the org, for {@link showsHomeLink}. */
export interface HomeLinkViewer {
  /** `owner`, `admin`, `member` or `guest`; `null` when not in the org. */
  role: string | null;
  /** How the org holds its apps; `null` on a node without app teams. */
  mode: OrgMode | null;
}

/**
 * Whether the viewer gets "Manage people in Calimero Home": owners and admins
 * always; members when the org keeps its apps apart (`shared`), so who is in
 * which app is Home's to show. A guest has no directory in Home, and a member
 * of an open org (`legacy`, `standalone`) manages nothing there.
 */
export function showsHomeLink(viewer: HomeLinkViewer): boolean {
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  return viewer.role === "member" && viewer.mode === "shared";
}

/** The account's role and the org's mode, or `null` when they cannot be read. */
export async function homeLinkViewer(
  client: ClientRoutes<{ auth: "me"; orgs: "get" }>,
  org: string,
): Promise<HomeLinkViewer | null> {
  try {
    const [me, view] = await Promise.all([client.auth.me(), client.orgs.get({ org }).catch(() => null)]);
    const orgs = (me as { orgs?: Array<{ orgId?: unknown; role?: unknown }> }).orgs ?? [];
    const mine = orgs.find((o) => o.orgId === org);
    const role = typeof mine?.role === "string" ? mine.role : null;
    const mode = (view as { mode?: unknown } | null)?.mode;
    return {
      role,
      mode: mode === "legacy" || mode === "standalone" || mode === "shared" ? mode : null,
    };
  } catch {
    return null;
  }
}

/**
 * The "Manage people in Calimero Home" link for `org`, or `null` when it does
 * not apply: no Home on this cluster ({@link findHome}), or the viewer is not
 * one Home serves for it ({@link showsHomeLink}).
 */
export async function homeLinkFor(
  client: ClientRoutes<{ packages: "get"; auth: "me"; orgs: "get" }>,
  target: Target | null | undefined,
  org: string | null | undefined,
  options: FindHomeOptions = {},
): Promise<string | null> {
  if (!org) return null;
  const home = await findHome(client, target, options);
  if (!home) return null;
  const viewer = await homeLinkViewer(client, org);
  if (!viewer || !showsHomeLink(viewer)) return null;
  return homeUrl(home.origin, home.version, org);
}
