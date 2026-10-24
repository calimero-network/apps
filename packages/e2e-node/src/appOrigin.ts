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
