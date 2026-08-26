#!/usr/bin/env node
// Generate an app's typed contract client from its own ABI.
//
// WHY THIS WRAPPER EXISTS
//
// `@calimero-network/abi-codegen@1.2.2` emits one import that does not resolve
// against the current SDK:
//
//     import { MeroJs } from '@calimero-network/mero-react';
//
// `MeroJs` is exported by `@calimero-network/mero-js` (13.3.0). `mero-react`
// (6.0.4) does not re-export it — its surface is hooks, the provider and the
// storage helpers. So a freshly generated client fails `tsc -b` on its first
// line, which is why no app in the fleet had codegen wired despite the tool
// being published.
//
// The generated file says DO NOT EDIT and it means it: the whole value of
// codegen is that CI can regenerate and diff it. So the fix is applied here,
// deterministically, on every run — never by hand in the output.
//
// This is a workaround for an upstream bug, not a design. Two more to fix
// upstream while we are there, both visible in the generated output:
//
//   * the client's constructor requires `executorPublicKey` and passes it on
//     every call, but `ExecuteParams.executorPublicKey` is marked
//     `@deprecated  No longer used by the server. Ignored if provided.` — the
//     node derives the caller from the bearer token.
//
//   * `Option<T>` nullability is lost. `get(&self, key) -> Option<String>`
//     generates `Promise<string>`. That one is NOT codegen's fault: the ABI
//     itself records `"returns": {"kind": "string"}`, so the information is
//     already gone by the time codegen reads it. It needs fixing in core's ABI
//     emitter, and until then a generated signature cannot be trusted for
//     nullability — only for method names and argument names.
//
// Usage: node scripts/codegen.mjs --input <abi.json> --out <dir> --client <Name>

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || !process.argv[i + 1]) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return process.argv[i + 1];
}

const input = arg("input");
const out = arg("out");
const client = arg("client");

execFileSync(
  "calimero-abi-codegen",
  ["-i", input, "-o", out, "--client-name", client],
  { stdio: "inherit" },
);

// ── the fixup ────────────────────────────────────────────────────────────────
const WRONG = `from '@calimero-network/mero-react'`;
const RIGHT = `from '@calimero-network/mero-js'`;

let patched = 0;
for (const file of readdirSync(out).filter((f) => f.endsWith(".ts"))) {
  const path = join(out, file);
  const before = readFileSync(path, "utf8");
  if (!before.includes(WRONG)) continue;
  writeFileSync(path, before.split(WRONG).join(RIGHT));
  patched += 1;
  console.log(`   fixed MeroJs import in ${file}`);
}

// Loud rather than silent. If abi-codegen is ever fixed upstream this prints
// nothing and the wrapper becomes a no-op — which is the signal to delete it.
// If it prints nothing *unexpectedly*, the import moved again and the build is
// about to fail somewhere less obvious.
if (patched === 0) {
  console.log(
    "   note: no MeroJs import to fix — abi-codegen may have been fixed upstream (then delete this wrapper), or the import changed shape",
  );
}
