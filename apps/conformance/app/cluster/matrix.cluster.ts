/**
 * The 1.0 conformance matrix on a running cluster, from Node: the CI job
 * `Conformance (1.0, merod local)` and `pnpm -F conformance-1.0 test:cluster`.
 *
 *   CONFORMANCE_WASM   the built component (default ../logic/res/conformance.wasm:
 *                      `mero-component build apps/conformance/logic`)
 *   CONFORMANCE_NODES  the cluster's nodes, comma-separated (default merod local's
 *                      three, 127.0.0.1:2501-2503); passed to @calimero-apps/connect
 *                      as VITE_CALIMERO_NODES, so the clients are the page's
 *   CONFORMANCE_ORIGIN the origin the software passkeys answer for (default
 *                      http://localhost:5173, which merod local trusts)
 *
 * Writes test-results/conformance-report.json, prints every failing row, and
 * fails on any row whose outcome is not the one it expects.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveTarget } from "@calimero-apps/connect";
import { expect, it } from "vitest";

import { clientAt, softPasskey } from "../src/conformance/env";
import { runMatrix } from "../src/conformance/matrix";
import { report } from "../src/conformance/types";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../../..");

/** `component-min-runtime-version` from the root Cargo.toml: what the matrix's packages declare. */
function minRuntimeVersion(): string {
  const toml = readFileSync(resolve(root, "Cargo.toml"), "utf8");
  const m = /^component-min-runtime-version\s*=\s*"([^"]+)"/m.exec(toml);
  if (!m?.[1]) throw new Error("no component-min-runtime-version in the root Cargo.toml");
  return m[1];
}

it("every row of the matrix comes out as it expects", async () => {
  const wasm = new Uint8Array(readFileSync(process.env.CONFORMANCE_WASM ?? resolve(here, "../../logic/res/conformance.wasm")));
  const target = resolveTarget({
    VITE_CALIMERO_TARGET: "local",
    ...(process.env.CONFORMANCE_NODES ? { VITE_CALIMERO_NODES: process.env.CONFORMANCE_NODES } : {}),
  });
  const origin = process.env.CONFORMANCE_ORIGIN ?? "http://localhost:5173";
  const rows = await runMatrix({
    client: (i) => clientAt(target, i),
    passkey: () => softPasskey(origin),
    wasm,
    minRuntimeVersion: minRuntimeVersion(),
    onRow: (r) => console.log(`${r.pass ? "PASS" : "FAIL"} [${r.who}] ${r.name}: expected ${r.expected}, got ${r.actual}${r.pass ? "" : ` — ${r.error ?? r.detail ?? ""}`}`),
  });
  const out = report(rows);
  const file = resolve(here, "../test-results/conformance-report.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`${out.summary.passed}/${out.summary.rows} rows pass; report: ${file}`);
  expect(rows.filter((r) => !r.pass).map((r) => `${r.name} [${r.who}]: expected ${r.expected}, got ${r.actual} ${r.error ?? ""}`)).toEqual([]);
});
