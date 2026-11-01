// The matrix on a running cluster (`merod local` by default): `pnpm test:cluster`.
// Node, not jsdom: the same CalimeroClient calls the page makes, from Node's
// fetch and WebCrypto. See cluster/matrix.cluster.ts for what it needs.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["cluster/**/*.cluster.ts"],
    // One run of the whole matrix: minutes, not the default 5 s.
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
});
