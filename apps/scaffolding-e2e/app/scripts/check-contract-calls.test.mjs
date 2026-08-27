// Gates CI: `pnpm test` runs this, and the TypeScript job runs `pnpm test`.
//
// The first test is the actual gate — it fails the build if the frontend, the
// merobox workflows and the contract have drifted apart. The rest test the
// checker itself, because a checker that silently parses nothing also reports
// success, and that failure mode is exactly the one this repo already lived
// through once.

import { describe, expect, it } from "vitest";

import {
  checkContractCalls,
  collectFrontendCalls,
  collectWorkflowCalls,
  formatReport,
  readAbi,
  UNCALLED_BY_DESIGN,
} from "./check-contract-calls.mjs";

describe("frontend ↔ contract ↔ workflows", () => {
  it("agree", () => {
    const report = checkContractCalls();
    expect(formatReport(report)).toContain("agree");
    expect(report.unknownMethod).toEqual([]);
    expect(report.wrongArgs).toEqual([]);
    expect(report.uncalled).toEqual([]);
  });
});

describe("the checker itself", () => {
  it("reads a non-trivial ABI", () => {
    const abi = readAbi();
    expect(abi.size).toBeGreaterThan(50);
    // A method with arguments, so an ABI that parsed but dropped every `params`
    // cannot pass the argument check by having nothing to compare.
    expect([...abi.get("set")].sort()).toEqual(["key", "value"]);
  });

  it("finds the frontend's calls, with their argument names", () => {
    const sites = collectFrontendCalls();
    expect(sites.length).toBeGreaterThan(50);

    // Shorthand properties (`{ key, value }`) are how nearly every binding in
    // kvStore.ts is written. A scan that only understands `key: value` reports
    // every one of them as sending no arguments — which passes the "no extra
    // args" half of the check and silently gives up on the other half.
    const set = sites.find((s) => s.method === "set");
    expect([...set.args].sort()).toEqual(["key", "value"]);

    const zeroArg = sites.find((s) => s.method === "entries");
    expect([...zeroArg.args]).toEqual([]);
  });

  it("finds the merobox workflows' calls, with their argument names", () => {
    const sites = collectWorkflowCalls();
    expect(sites.length).toBeGreaterThan(100);

    const set = sites.filter((s) => s.method === "set");
    expect(set.length).toBeGreaterThan(0);
    for (const s of set) expect([...s.args].sort()).toEqual(["key", "value"]);

    // Nothing outside logic/workflows/ should be scanned.
    for (const s of sites) expect(s.where.startsWith("logic/workflows/")).toBe(true);
  });

  it("covers the whole contract between the two layers", () => {
    const abi = readAbi();
    const called = new Set(
      [...collectFrontendCalls(), ...collectWorkflowCalls()].map((s) => s.method),
    );
    for (const method of abi.keys()) {
      if (method in UNCALLED_BY_DESIGN) continue;
      expect(called, `${method} has no caller`).toContain(method);
    }
  });

  it("only excuses methods that exist", () => {
    // An entry left behind after a method is renamed or deleted would quietly
    // stop excusing anything, and quietly stop being questioned.
    const abi = readAbi();
    for (const method of Object.keys(UNCALLED_BY_DESIGN)) {
      expect(abi.has(method), `UNCALLED_BY_DESIGN lists ${method}, which the ABI does not`).toBe(
        true,
      );
    }
  });
});
