/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { calimeroCsp } from "@calimero-apps/cloud/vite";

export default defineConfig({
  base: "./",
  plugins: [calimeroCsp(), react()],
  // Passkeys are bound to an origin: the cluster must list this one
  // (`merod-v2 local` allows http://localhost:5173 by default).
  server: { port: 5173, strictPort: true, host: "localhost" },
  // Playwright runs e2e/; vitest only the unit tests beside the code.
  test: { include: ["src/**/*.test.ts"] },
});
