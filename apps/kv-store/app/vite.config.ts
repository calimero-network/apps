import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  // Passkeys are bound to an origin: the cluster must list this one
  // (`merod-v2 local` allows http://localhost:5173 by default).
  server: { port: 5173, strictPort: true, host: "localhost" },
});
