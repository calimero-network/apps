import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HyperfeedClient } from "./generated/HyperfeedClient";

const HERE = dirname(fileURLToPath(import.meta.url));
const ABI = resolve(HERE, "..", "..", "logic", "res", "abi.json");

/** snake_case -> camelCase, the transform abi-codegen applies to method names. */
function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe("the generated client covers the contract", () => {
  const abi = JSON.parse(readFileSync(ABI, "utf8")) as { methods: { name: string }[] };
  const all = abi.methods.map((m) => m.name);
  const onClient = new Set(
    Object.getOwnPropertyNames(HyperfeedClient.prototype).filter((n) => n !== "constructor"),
  );

  it("has a method for every callable ABI method", () => {
    // Fails when the contract grows a method and `pnpm codegen` was not re-run.
    const missing = all.filter((n) => n !== "init").filter((n) => !onClient.has(camel(n)));
    expect(missing).toEqual([]);
  });

  it("has no method the ABI does not define", () => {
    const extra = [...onClient].filter((n) => !all.some((abiName) => camel(abiName) === n));
    expect(extra).toEqual([]);
  });

  it("imports its transport from mero-js, not mero-react", () => {
    const src = readFileSync(resolve(HERE, "generated", "HyperfeedClient.ts"), "utf8");
    expect(src).toContain("@calimero-network/mero-js");
  });
});
