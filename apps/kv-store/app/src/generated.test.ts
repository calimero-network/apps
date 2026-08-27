import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { KvStoreClient } from "./generated/KvStoreClient";

const HERE = dirname(fileURLToPath(import.meta.url));
const ABI = resolve(HERE, "..", "..", "logic", "res", "abi.json");

/** snake_case -> camelCase, the transform abi-codegen applies to method names. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe("the generated client covers the contract", () => {
  const abi = JSON.parse(readFileSync(ABI, "utf8")) as {
    methods: { name: string }[];
  };

  const all = abi.methods.map((m) => m.name);

  // `init` is called once by the node at context creation and is not on the
  // RPC surface. abi-codegen generates a client method for it anyway, so it is
  // allowed to be PRESENT but is not REQUIRED — hence two different lists.
  const callable = all.filter((n) => n !== "init");

  const onClient = new Set(
    Object.getOwnPropertyNames(KvStoreClient.prototype).filter((n) => n !== "constructor"),
  );

  it("has a method for every callable ABI method", () => {
    // This is the assertion that makes codegen worth having: it fails if the
    // contract grows a method and `pnpm codegen` was not re-run, which is the
    // same drift that shipped a whole frontend section calling 13 `ws_*`
    // methods no contract had ever defined.
    const missing = callable.filter((n) => !onClient.has(camel(n)));
    expect(missing).toEqual([]);
  });

  it("has no method the ABI does not define", () => {
    const extra = [...onClient].filter((n) => !all.some((abiName) => camel(abiName) === n));
    expect(extra).toEqual([]);
  });

  it("imports MeroJs from mero-js, not mero-react", () => {
    // abi-codegen DEFAULTS the import to `@calimero-network/mero-react`, which
    // does not export `MeroJs` — mero-react's surface is hooks, the provider and
    // the storage helpers. A client generated with the default fails `tsc -b` on
    // its first line. `--import-path @calimero-network/mero-js` in the codegen
    // script is what corrects it; this asserts the flag is still being passed.
    const src = readFileSync(resolve(HERE, "generated", "KvStoreClient.ts"), "utf8");
    expect(src).toContain("from '@calimero-network/mero-js'");
    expect(src).not.toContain("from '@calimero-network/mero-react'");
  });
});
