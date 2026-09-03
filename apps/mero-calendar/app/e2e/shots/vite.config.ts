import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

/**
 * Build for the screenshot harness (see ../shots.mjs).
 *
 * Only the two modules that need a node are aliased: `hooks/useMembers` (which
 * reads redux, fed by the node) and `@calimero-network/mero-react` (one call,
 * `getContextIdentity`). ModalFormEvent itself, its CSS modules, the date/time
 * pickers, the colour picker, the text field, useForm and the validation schema
 * are all PRODUCTION code — a screenshot of a re-implementation would prove
 * nothing about the contrast being fixed.
 *
 * A separate config rather than a flag in the app's own: an alias that applies
 * "when an env var is set" is one misconfigured deploy from shipping the mock.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("."),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: [
      { find: /.*\/hooks\/useMembers$/, replacement: here("./useMembers.mock.ts") },
      { find: "@calimero-network/mero-react", replacement: here("./meroReact.mock.ts") },
    ],
  },
  build: { outDir: here("../../../data/shots-build"), emptyOutDir: true },
});
