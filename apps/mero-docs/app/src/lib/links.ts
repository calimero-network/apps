import { appPath, parseAppPath } from './routes';
import type { DocHrefTarget } from './workspaceIndex/types';

export type { DocHrefTarget } from './workspaceIndex/types';

// Deployments whose doc links count as ours, besides the current origin.
export const KNOWN_APP_ORIGINS: readonly string[] = [
  'https://mero-docs.vercel.app',
];
const MEMBER_SEGMENT = 'm'; // `/app/<ws>/m/<account>` names a workspace member
const ACCOUNT_HEX = /^[0-9a-f]{64}$/i; // the node's account id, as the docs contract stores it

export type MemberHrefTarget = { ws: string; member: string };

/** `href` resolved on `origin`, if it is a page of this app on a known origin. */
function appUrl(href: string, origin: string): URL | null {
  let url: URL;
  let current: string;
  try {
    current = new URL(origin).origin;
    url = new URL(href, current);
  } catch {
    return null;
  }
  const known =
    url.origin === current || KNOWN_APP_ORIGINS.includes(url.origin);
  return known ? url : null;
}

/** The doc an href points at, if it is a Mero Docs doc URL; relative hrefs resolve on `origin`. */
export function parseDocHref(
  href: string,
  origin: string,
): DocHrefTarget | null {
  const url = appUrl(href, origin);
  if (!url) return null;
  const route = parseAppPath(url.pathname, url.hash);
  if (!route?.folder || !route.doc) return null;
  const { ws, folder, doc, block } = route;
  return block ? { ws, folder, doc, block } : { ws, folder, doc };
}

export function docHref(t: DocHrefTarget): string {
  return appPath(t);
}

/** The member a mention links to; relative hrefs resolve on `origin`. */
export function parseMemberHref(
  href: string,
  origin: string,
): MemberHrefTarget | null {
  const url = appUrl(href, origin);
  const parts = url?.pathname.split('/') ?? [];
  const [lead, app, rawWs, kind, member, ...rest] = parts;
  if (lead !== '' || app !== 'app' || kind !== MEMBER_SEGMENT || rest.length)
    return null;
  let ws: string;
  try {
    ws = decodeURIComponent(rawWs);
  } catch {
    return null;
  }
  return ws && ACCOUNT_HEX.test(member) ? { ws, member } : null;
}

export function memberHref(t: MemberHrefTarget): string {
  return `/app/${encodeURIComponent(t.ws)}/${MEMBER_SEGMENT}/${t.member}`;
}
