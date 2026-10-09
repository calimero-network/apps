/**
 * Two real nodes, two browsers, one fight — recorded.
 *
 *   cargo mero bundle --manifest-path ../logic/Cargo.toml --dev \
 *     --output ../logic/dist/com.calimero.mero-kombat.mpk
 *   pnpm record:duel
 *
 * Boots the same two meshed native nodes as the lifecycle journey, logs a
 * browser into each, puts the two fighters in opposite corners of one arena and
 * lets two bots fight a full match through the keyboard. Each browser is
 * recorded, and the two recordings are stitched side by side into
 * `test-results/duel/duel.mp4` (needs ffmpeg on PATH).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { journeyConfig } from "@calimero-apps/e2e-node/config";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const base = journeyConfig({ appDir, packageId: "com.calimero.mero-kombat", port: 5392 });

export default {
  ...base,
  testDir: path.join(appDir, "e2e", "duel"),
  testMatch: /.*\.duel\.ts$/,
  outputDir: path.join(appDir, "test-results", "duel-runs"),
  timeout: 20 * 60_000,
};
