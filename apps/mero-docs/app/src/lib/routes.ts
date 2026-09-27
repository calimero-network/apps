// URL shapes for the workspace screens. Ids are opaque, so each one is a single
// percent-encoded path segment; a malformed tail degrades to its valid prefix.

import { toast } from 'sonner';

const BLOCK_PARAM = 'b'; // `#b=<blockId>` on a doc URL
const RETURN_TO_KEY = 'mero-drive:returnTo'; // sessionStorage: survives the sign-in redirect

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
  const [app, rawWs, kind, rawFolder, docKind, rawDoc] = pathname
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
  return `${window.location.origin}${appPath({ ws, folder, doc, block })}`;
}

export function saveReturnTo(path: string): void {
  sessionStorage.setItem(RETURN_TO_KEY, path);
}

export function clearReturnTo(): void {
  sessionStorage.removeItem(RETURN_TO_KEY);
}

/** Where a signed-out visitor was headed, if it is a page of this app. */
export function readReturnTo(): string | null {
  const raw = sessionStorage.getItem(RETURN_TO_KEY);
  if (!raw) return null;
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

export async function copyLink(url: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied');
  } catch {
    toast.error("Couldn't copy link");
  }
}
