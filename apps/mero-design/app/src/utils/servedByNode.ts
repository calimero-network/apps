import { isServedByNode, nodeBasename as basename } from "@calimero-apps/node-served";

export const SERVED_BY_NODE = isServedByNode(new URL(window.location.href));

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
const BASE = basename(new URL(window.location.href), "/");
export const nodeBasename = (): string => BASE;
