// Copy the built contract next to the frontend, so "Create a store" can upload it.
// Build it first: cargo build -p kv-store --target wasm32-unknown-unknown --profile app-release
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from =
  process.env.KV_STORE_WASM ??
  resolve(here, "../../../../target/wasm32-unknown-unknown/app-release/kv_store.wasm");
if (!existsSync(from)) {
  console.error(`${from} is missing; build the contract first`);
  process.exit(1);
}
mkdirSync(resolve(here, "../public"), { recursive: true });
copyFileSync(from, resolve(here, "../public/kv_store.wasm"));
