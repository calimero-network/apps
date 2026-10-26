import type { RigNode } from "./rig";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567"; // RFC 4648, lowercase

/** True when the journey drives the app from the frontend its node serves, not a local vite server. */
export const fromNode = (): boolean => process.env["JOURNEY_FROM_NODE"] === "1";

/** The DNS label a node serves an app under: its application id (64 hex digits) as unpadded lowercase base32. */
export function appLabel(applicationId: string): string {
  if (!/^[0-9a-f]{64}$/.test(applicationId)) {
    throw new Error(`application id ${applicationId} is not 64 lowercase hex digits`);
  }
  let label = "";
  let acc = 0;
  let bits = 0;
  for (const byte of Buffer.from(applicationId, "hex")) {
    acc = (acc << 8) | byte;
    bits += 8;
    for (; bits >= 5; bits -= 5) label += BASE32[(acc >> (bits - 5)) & 31];
    acc &= (1 << bits) - 1;
  }
  return bits > 0 ? label + BASE32[(acc << (5 - bits)) & 31] : label;
}

/** Where the node serves the app's frontend; `/` there redirects to the newest installed version. */
export function appOrigin(node: Pick<RigNode, "serverPort" | "applicationId">): string {
  return `http://${appLabel(node.applicationId)}.localhost:${node.serverPort}`;
}

/** The app's origin plus its newest version's prefix, so a driver's relative `page.goto("agreements")` stays under it. */
export async function appBase(node: Pick<RigNode, "serverPort" | "applicationId">): Promise<string> {
  const origin = appOrigin(node);
  const location = (await fetch(`${origin}/`, { redirect: "manual" })).headers.get("location");
  if (!location) throw new Error(`${origin}/ did not redirect to a version: is the app installed with a frontend?`);
  return new URL(location.endsWith("/") ? location : `${location}/`, origin).href;
}

/** Context options that point a journey's own browser context at the app: its node's frontend when JOURNEY_FROM_NODE=1, else the dev server. */
export async function appContextOptions(node: Pick<RigNode, "serverPort" | "applicationId">): Promise<{ baseURL?: string }> {
  return fromNode() ? { baseURL: await appBase(node) } : {};
}

/** A URL's path as the app's router sees it: without the `/{version}` prefix a node serves the app under. */
export function routePath(url: string): string {
  const { pathname } = new URL(url);
  return fromNode() ? pathname.replace(/^\/[^/]+/, "") || "/" : pathname;
}
