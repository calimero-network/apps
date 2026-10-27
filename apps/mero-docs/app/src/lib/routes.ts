import { nodeUrl, stripNodeBase } from '@/lib/servedByNode';

// URL shapes for the workspace screens. Ids are opaque, so each one is a single
// percent-encoded path segment; a malformed tail degrades to its valid prefix.

const BLOCK_PARAM = 'b'; // `#b=<blockId>` on a doc URL
const RETURN_TO_KEY = 'mero-drive:returnTo'; // sessionStorage: survives the sign-in redirect
const RETURN_OWN_NODE_KEY = 'mero-drive:returnToNode'; // set when returnTo is the user's own page

export type AppRoute = {
  ws: string;
  folder?: string;
  doc?: string;
  block?: string;
  settings?: boolean;
};

function decode(segment: string | undefined): string | undefined {
  if (segment === undefined) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** The screen a path names; null when it is not under `/app/<ws>`. */
export function parseAppPath(pathname: string, hash: string): AppRoute | null {
  const [app, rawWs, kind, rawFolder, docKind, rawDoc] = stripNodeBase(pathname)
    .split('/')
    .filter(Boolean);
  const ws = app === 'app' ? decode(rawWs) : undefined;
  if (!ws) return null;
  if (kind === 'settings') return { ws, settings: true };
  const folder = kind === 'f' ? decode(rawFolder) : undefined;
  if (!folder) return { ws };
  const doc = docKind === 'd' ? decode(rawDoc) : undefined;
  if (!doc) return { ws, folder };
  const block = new URLSearchParams(hash.replace(/^#/, '')).get(BLOCK_PARAM);
  return block ? { ws, folder, doc, block } : { ws, folder, doc };
}

/** Relative path for a route, with the `#b=` hash when a doc block is set. */
export function appPath(route: AppRoute): string {
  const base = `/app/${encodeURIComponent(route.ws)}`;
  if (route.settings) return `${base}/settings`;
  if (!route.folder) return base;
  const folderPath = `${base}/f/${encodeURIComponent(route.folder)}`;
  if (!route.doc) return folderPath;
  const docPath = `${folderPath}/d/${encodeURIComponent(route.doc)}`;
  if (!route.block) return docPath;
  return `${docPath}#${new URLSearchParams({ [BLOCK_PARAM]: route.block })}`;
}

export function docUrl(ws: string, folder: string, doc: string, block?: string): string {
  return nodeUrl(appPath({ ws, folder, doc, block }));
}

export function homeUrl(ws: string, search: string): string {
  return nodeUrl(`${appPath({ ws })}${search ? `?${search}` : ''}`);
}

/**
 * Remember where a signed-out visitor was headed. `ownNode` marks the path as
 * the visitor's own last page rather than a link, and names the node it was
 * on (null when unknown): it is only given back after sign-in to that node.
 * Settings is saved as its workspace's Home: it is not a page to land on.
 */
export function saveReturnTo(path: string, ownNode?: string | null): void {
  let saved = path;
  try {
    const url = new URL(path, window.location.origin);
    const route = parseAppPath(url.pathname, url.hash);
    if (route?.settings) saved = appPath({ ws: route.ws }) + url.search;
  } catch {
    // An unparseable path is refused by readReturnTo anyway.
  }
  sessionStorage.setItem(RETURN_TO_KEY, saved);
  if (ownNode === undefined) sessionStorage.removeItem(RETURN_OWN_NODE_KEY);
  else sessionStorage.setItem(RETURN_OWN_NODE_KEY, ownNode ?? '');
}

export function clearReturnTo(): void {
  sessionStorage.removeItem(RETURN_TO_KEY);
  sessionStorage.removeItem(RETURN_OWN_NODE_KEY);
}

/** Where a signed-out visitor was headed, if it is a page of this app that
 *  still applies on `nodeUrl`, the node just signed in to. */
export function readReturnTo(nodeUrl: string | null = null): string | null {
  const raw = sessionStorage.getItem(RETURN_TO_KEY);
  if (!raw) return null;
  // Another node's own page names a workspace this node may not hold.
  const ownNode = sessionStorage.getItem(RETURN_OWN_NODE_KEY);
  if (ownNode !== null && (!ownNode || ownNode !== nodeUrl)) return null;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return null;
  }
  const inApp = url.pathname === '/app' || url.pathname.startsWith('/app/');
  if (url.origin !== window.location.origin || !inApp) return null;
  return url.pathname + url.search + url.hash;
}
