import { appPath, parseAppPath } from './routes';
import type { DocHrefTarget } from './workspaceIndex/types';

export type { DocHrefTarget } from './workspaceIndex/types';

// Deployments whose doc links count as ours, besides the current origin.
export const KNOWN_APP_ORIGINS: readonly string[] = [
  'https://mero-docs.vercel.app',
];

/** The doc an href points at, if it is a Mero Docs doc URL; relative hrefs resolve on `origin`. */
export function parseDocHref(
  href: string,
  origin: string,
): DocHrefTarget | null {
  let url: URL;
  let current: string;
  try {
    current = new URL(origin).origin;
    url = new URL(href, current);
  } catch {
    return null;
  }
  if (url.origin !== current && !KNOWN_APP_ORIGINS.includes(url.origin)) {
    return null;
  }
  const route = parseAppPath(url.pathname, url.hash);
  if (!route?.folder || !route.doc) return null;
  const { ws, folder, doc, block } = route;
  return block ? { ws, folder, doc, block } : { ws, folder, doc };
}

export function docHref(t: DocHrefTarget): string {
  return appPath(t);
}
