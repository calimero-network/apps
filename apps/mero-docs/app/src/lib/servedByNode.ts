import {
  isServedByNode,
  nodeBasename as basename,
} from '@calimero-apps/node-served';

// Read at call time, and null outside a browser: the e2e specs call route helpers in node.
const here = (): URL | null =>
  typeof window === 'undefined' ? null : new URL(window.location.href);

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
export const nodeBasename = (): string => {
  const url = here();
  return url ? basename(url, '/') : '/';
};

// An absolute app path (`/app/x`) as a full URL, under the node's version prefix.
export function nodeUrl(path: string): string {
  return `${window.location.origin}${nodeBasename().slice(0, -1)}${path}`;
}

// A pasted full URL carries the version prefix; router paths do not.
export function stripNodeBase(pathname: string): string {
  const base = nodeBasename();
  const url = here();
  return url && isServedByNode(url) && pathname.startsWith(base)
    ? `/${pathname.slice(base.length)}`
    : pathname;
}
