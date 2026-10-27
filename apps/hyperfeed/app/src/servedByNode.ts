import { nodeBasename as basename } from "@calimero-apps/node-served";

// Router basename with a trailing slash: `/<version>/` on a node, else `/`.
const BASE = basename(new URL(window.location.href), "/");
export const nodeBasename = (): string => BASE;
