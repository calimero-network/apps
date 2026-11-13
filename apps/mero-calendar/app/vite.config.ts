import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { installableApp } from "@calimero-apps/install/vite";

// Relative, so the same build runs at / and under the path the cluster serves
// the bundle's frontend from. `pnpm dev:local mero-calendar` runs this on
// http://localhost:5173, the origin `merod local` trusts passkeys from.
export default defineConfig({
  base: "./",
  plugins: [installableApp({ cacheId: "mero-calendar" }), react()],
});
