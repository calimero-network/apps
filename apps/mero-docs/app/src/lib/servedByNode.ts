import { isServedByNode, nodeBasename as basename } from '@calimero-apps/node-served';

export const SERVED_BY_NODE = isServedByNode(new URL(window.location.href));

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
const BASE = basename(new URL(window.location.href), '/');
export const nodeBasename = (): string => BASE;

// An absolute app path (`/app/x`) as a full URL, under the node's version prefix.
export function nodeUrl(path: string): string {
  return `${window.location.origin}${nodeBasename().slice(0, -1)}${path}`;
}

// A pasted full URL carries the version prefix; router paths do not.
export function stripNodeBase(pathname: string): string {
  const base = nodeBasename();
  return SERVED_BY_NODE && pathname.startsWith(base) ? `/${pathname.slice(base.length)}` : pathname;
}
