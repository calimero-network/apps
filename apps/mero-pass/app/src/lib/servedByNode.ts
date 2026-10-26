import {
  isServedByNode,
  nodeBasename as basename,
} from '@calimero-apps/node-served';

// Share links are also built where there is no window (the portability tests run in node).
const here = () => new URL(globalThis.location?.href ?? 'http://localhost/');

export const SERVED_BY_NODE = isServedByNode(here());

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
export const nodeBasename = (): string => basename(here(), '/');
