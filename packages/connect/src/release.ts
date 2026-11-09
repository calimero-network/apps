/**
 * Serve each app instance the frontend of the release IT runs.
 *
 * An app's frontend ships inside its signed `.mpk` and may only work with that
 * release's backend, so a page entering an instance that runs another release
 * moves to that release's frontend. The cluster serves every release of a
 * package from its own path on the package's origin (`/{version}/`, the
 * router's basename there), and `/app/{app}/{path}` redirects to
 * `/{version}/{path}` of the release that instance runs (core's
 * `app_host::instance_release`), keeping the query. The page goes there with
 * its in-app route, query and fragment, so the person lands in the same place.
 *
 * Nothing happens in development (vite, a static host): there is no
 * `/{version}/` to move between.
 *
 * Never a loop: before moving, the tab remembers the release it is going for
 * ({@link RELEASE_FOLLOW_KEY}, `sessionStorage`). Landing on a page that
 * still differs (a core that does not record an instance's release and picks
 * another release of the same WASM) finds that note and stays. With no
 * storage to write the note to, it stays too.
 */
import type { CalimeroClient } from "@calimero-network/mero-js";

import type { KeyValueStorage } from "./client";

/** The tab's note of a release it moved to, read on the page it lands on. */
export const RELEASE_FOLLOW_KEY = "cp-release:follow";
/** How long that note stops another move to the same release. */
const FOLLOW_TTL_MS = 10 * 60 * 1000;

/** A node's app host: `{label}.{apps domain}` (also a cluster's or a deployment's label), 52 base32 characters. */
const APP_HOST = /^[a-z2-7]{52}\./;
/** A release's path segment, as core serves it. */
const RELEASE_SEGMENT = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/;

/**
 * The release whose frontend this page is: the first path segment of a page
 * a node serves from its app host (`/{version}/…`). `null` anywhere else
 * (development, a static host), where no instance is ever moved.
 */
export function servedRelease(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!APP_HOST.test(url.hostname)) return null;
  const segment = url.pathname.split("/")[1] ?? "";
  let version: string;
  try {
    version = decodeURIComponent(segment);
  } catch {
    return null;
  }
  return RELEASE_SEGMENT.test(version) ? version : null;
}

/**
 * Where this page continues on the frontend of the release `app` runs:
 * `{origin}/app/{app}/{route}{query}{fragment}`, the route being the path after
 * this page's `/{version}/`. `null` on a page no node serves.
 */
export function instanceReleaseUrl(href: string, app: string): string | null {
  if (servedRelease(href) === null) return null;
  const url = new URL(href);
  const route = url.pathname.split("/").slice(2).join("/");
  return `${url.origin}/app/${encodeURIComponent(app)}/${route}${url.search}${url.hash}`;
}

interface FollowNote {
  app: string;
  to: string;
  at: number;
}

function readNote(storage: KeyValueStorage): FollowNote | null {
  try {
    const raw = storage.getItem(RELEASE_FOLLOW_KEY);
    const v = raw ? (JSON.parse(raw) as Partial<FollowNote>) : null;
    if (!v || typeof v.app !== "string" || typeof v.to !== "string" || typeof v.at !== "number") return null;
    return { app: v.app, to: v.to, at: v.at };
  } catch {
    return null;
  }
}

function sessionStore(): KeyValueStorage | null {
  try {
    return (globalThis as { sessionStorage?: KeyValueStorage }).sessionStorage ?? null;
  } catch {
    return null;
  }
}

export interface FollowReleaseOptions {
  /** The instance being entered (app id). */
  app: string;
  /** The release it runs; `null` when it is not known, which never moves. */
  release: string | null;
  /** This page's URL; `location.href` by default. */
  href?: string;
  /** Where the tab's note goes; `sessionStorage` by default. `null`: none, so never move. */
  storage?: KeyValueStorage | null;
  /** Sends the browser on; `location.replace` by default (the old release's page is not one to go back to). */
  navigate?: (url: string) => void;
  now?: () => number;
}

/**
 * Moves this page to the frontend of the release `app` runs when it is
 * another release's, and says whether it did. Stays (returns `false`) in
 * development, when the release is not known or is this page's, and when
 * this tab already moved for that release and landed here anyway.
 */
export function followRelease(options: FollowReleaseOptions): boolean {
  const href = options.href ?? globalThis.location?.href ?? "";
  const here = servedRelease(href);
  const { app, release } = options;
  if (here === null || release === null || !app) return false;
  const storage = options.storage === undefined ? sessionStore() : options.storage;
  const now = (options.now ?? Date.now)();
  if (here === release) {
    // Arrived: the note has done its work.
    if (storage && readNote(storage)?.app === app) {
      try {
        storage.removeItem(RELEASE_FOLLOW_KEY);
      } catch {
        /* it lapses on its own */
      }
    }
    return false;
  }
  if (!storage) return false;
  const note = readNote(storage);
  if (note && note.app === app && note.to === release && now - note.at < FOLLOW_TTL_MS) return false;
  const url = instanceReleaseUrl(href, app);
  if (url === null) return false;
  try {
    storage.setItem(RELEASE_FOLLOW_KEY, JSON.stringify({ app, to: release, at: now } satisfies FollowNote));
  } catch {
    return false;
  }
  (options.navigate ?? ((u: string) => globalThis.location.replace(u)))(url);
  return true;
}

/** The part of the client {@link instanceRelease} reads. */
export type ReleaseClient = Pick<CalimeroClient, "getApp" | "appsReportAll">;

/**
 * The release `app` runs, as its scope's report says (`package.version`: the
 * account's own report, or its organization's). `null` when it cannot be read.
 */
export async function instanceRelease(client: ReleaseClient, app: string): Promise<string | null> {
  try {
    const record = (await client.getApp(app)) as { org?: unknown };
    const org = typeof record.org === "string" ? record.org : null;
    const report = await client.appsReportAll(org);
    const version = report.apps.find((a) => a.app === app)?.package?.version;
    return typeof version === "string" && version ? version : null;
  } catch {
    return null;
  }
}

export interface FollowInstanceReleaseOptions extends Omit<FollowReleaseOptions, "release"> {
  client: ReleaseClient;
}

/**
 * {@link followRelease} for the instance `app`, reading the release it runs
 * ({@link instanceRelease}). Reads nothing on a page no node serves.
 */
export async function followInstanceRelease(options: FollowInstanceReleaseOptions): Promise<boolean> {
  const href = options.href ?? globalThis.location?.href ?? "";
  if (servedRelease(href) === null || !options.app) return false;
  const release = await instanceRelease(options.client, options.app);
  return followRelease({ ...options, href, release });
}
