// @vitest-environment node
/**
 * Every web app's trust policy comes from `policyFor`, so a bundled frontend
 * served on production trusts `locked-read-only` only and one served on staging
 * any of its profiles, by the page's hostname alone (`connectTarget`). An app
 * or package that made its own `CalimeroClient` would choose its own policy and
 * bypass that rule, so none may: they connect through `createClient`
 * (directly, or through `@calimero-apps/passkey`'s session).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/** Where a client may be made: this package, and merod local's dev cluster (mock quotes only). */
const ALLOWED = ["packages/connect/src/client.ts", "packages/merod-local/src/cluster.ts"];

const MAKES_A_CLIENT = /new\s+CalimeroClient\s*\(|CalimeroClient\s*\.\s*(connect|connectHere)\s*\(/;

function sources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !/\.test\.|\.spec\./.test(name)) out.push(path);
  }
  return out;
}

describe("one trust path", () => {
  it("no app or package makes a CalimeroClient except through createClient", () => {
    const files = [...sources(join(ROOT, "apps")), ...sources(join(ROOT, "packages"))];
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .map((path) => relative(ROOT, path))
      .filter((path) => !ALLOWED.includes(path) && !/\/(e2e|tests?)\//.test(path))
      .filter((path) => MAKES_A_CLIENT.test(readFileSync(join(ROOT, path), "utf8")));
    expect(offenders, "connect through @calimero-apps/connect's createClient, whose policy is policyFor").toEqual([]);
  });
});
