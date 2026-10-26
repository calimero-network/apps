import {
  isServedByNode,
  nodeBasename as basename,
} from '@calimero-apps/node-served';

// Read at call time, not import time: the e2e specs import route helpers outside a browser.
const here = (): URL => new URL(window.location.href);

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
export const nodeBasename = (): string => basename(here(), '/');

// An absolute app path (`/app/x`) as a full URL, under the node's version prefix.
export function nodeUrl(path: string): string {
  return `${window.location.origin}${nodeBasename().slice(0, -1)}${path}`;
}

// A pasted full URL carries the version prefix; router paths do not.
export function stripNodeBase(pathname: string): string {
  const base = nodeBasename();
  return isServedByNode(here()) && pathname.startsWith(base)
    ? `/${pathname.slice(base.length)}`
    : pathname;
}
