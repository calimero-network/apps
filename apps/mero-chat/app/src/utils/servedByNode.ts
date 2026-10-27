import { isServedByNode, nodeBasename as basename } from "@calimero-apps/node-served";

export const SERVED_BY_NODE = isServedByNode(new URL(window.location.href));

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
const BASE = basename(new URL(window.location.href), "/");
export const nodeBasename = (): string => BASE;

// A node's CSP allows only same-origin images, so remote avatars cannot load.
export const DEFAULT_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#9aa3b2"/><circle cx="12" cy="9" r="4" fill="#fff"/><path d="M4 20a8 8 0 0 1 16 0z" fill="#fff"/></svg>',
  );
