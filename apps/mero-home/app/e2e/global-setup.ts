/**
 * Seeds what Home's e2e opens: Ana (a software passkey) owns `Acme`, which
 * holds one KV Store instance with organization access (a legacy app, as every
 * org held its apps before app teams), and an admin invite for the browser.
 *
 * Needs a merod with core's app-team routes (core#4890, #4891); an older one
 * is refused here with that reason, never half-run.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  LOCAL_NODES,
  ROOT,
  healthy,
  signUp,
  startCluster,
} from "../../../../packages/merod-local/src/cluster.ts";

/** Where the seed is handed to the spec: beside the cluster's state, which is gitignored. */
export const SEED = join(ROOT, ".merod-local", "home-e2e-seed.json");

export interface Seed {
  org: string;
  owner: string;
  adminInvite: string;
  kvPackage: string;
}

/** A dev-signed KV Store `.mpk` (`mero-component bundle --dev`), built once. */
function kvStoreMpk(): string {
  const dist = join(ROOT, "dist");
  const find = () => {
    try {
      return readdirSync(dist).find((f) => f.startsWith("com.calimero.kv-store") && f.endsWith(".mpk"));
    } catch {
      return undefined;
    }
  };
  if (!find()) {
    execFileSync(
      "cargo",
      ["run", "--release", "--manifest-path", "tools/component-bundle/Cargo.toml", "--", "bundle", "apps/kv-store/logic", "--dev", "--no-frontend"],
      { cwd: ROOT, stdio: "inherit" },
    );
  }
  const file = find();
  if (!file) throw new Error(`no KV Store .mpk in ${dist} after bundling`);
  return join(dist, file);
}

export default async function globalSetup(): Promise<() => void> {
  const running = await healthy(LOCAL_NODES[0]!);
  const cluster = running ? null : await startCluster({ fresh: true, log: join(ROOT, ".merod-local", "home-e2e.log") });

  const ana = await signUp("Ana", LOCAL_NODES[0]!);
  const org = await ana.client.createOrg("Acme");
  try {
    await ana.client.listAppTeams(org);
  } catch (e) {
    cluster?.stop();
    throw new Error(
      `this merod has no app-team routes (GET /orgs/{org}/app-teams answered ${String(e)}): ` +
        "Calimero Home's e2e needs a core release with core#4890 and #4891 (1.0.0-rc.13 has neither)",
    );
  }

  const installed = await ana.client.uploadPackage(new Uint8Array(readFileSync(kvStoreMpk())));
  const kvPackage = installed.package;
  await ana.client.createApp("pipeline", { package: kvPackage }, { org });
  const adminInvite = await ana.client.invite(org, "admin", ana.passkey, undefined, { uses: 1 });

  const seed: Seed = { org, owner: ana.accountId, adminInvite, kvPackage };
  mkdirSync(dirname(SEED), { recursive: true });
  writeFileSync(SEED, JSON.stringify(seed));
  return () => cluster?.stop();
}
