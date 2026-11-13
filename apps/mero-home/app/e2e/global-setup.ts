/**
 * Seeds what Home's e2e opens: Ana (a software passkey) owns `Acme`, which
 * holds one KV Store instance with organization access (a legacy app, as every
 * org held its apps before app teams), and an admin invite for the browser.
 *
 * Needs a merod with core's app-team routes (core#4890, #4891), first released
 * in 1.0.0-rc.14; an older one is refused here with that reason, never half-run.
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
import { passkeyConfirm } from "@calimero-network/mero-js";

/** Where the seed is handed to the spec: beside the cluster's state, which is gitignored. */
export const SEED = join(ROOT, ".merod-local", "home-e2e-seed.json");

export interface Seed {
  org: string;
  owner: string;
  adminInvite: string;
  kvPackage: string;
}

/**
 * A dev-signed KV Store `.mpk`, built once into the root `dist/` (meroctl's own
 * default is the crate's `logic/dist/`): `scripts/component-build.sh` (meroctl
 * app build), then `meroctl app pack` with no `--key`, so the development key.
 */
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
    const wasm = execFileSync(join(ROOT, "scripts/component-build.sh"), ["apps/kv-store/logic"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "inherit"],
      encoding: "utf8",
    })
      .trim()
      .split("\n")
      .pop()!;
    execFileSync(
      "meroctl",
      [
        "app",
        "pack",
        "apps/kv-store/logic",
        "--wasm",
        wasm,
        "--no-frontend",
        "--out",
        join(dist, "com.calimero.kv-store-dev.mpk"),
      ],
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
  const org = (await ana.client.orgs.create({ name: "Acme" })).orgId;
  try {
    await ana.client.orgs.appTeamList({ org });
  } catch (e) {
    cluster?.stop();
    throw new Error(
      `this merod has no app-team routes (GET /orgs/{org}/app-teams answered ${String(e)}): ` +
        "Calimero Home's e2e needs core 1.0.0-rc.14 or later (core#4890 and #4891)",
    );
  }

  const installed = await ana.client.packages.upload({
    body: new Uint8Array(readFileSync(kvStoreMpk())),
    contentType: "application/octet-stream",
  });
  const kvPackage = installed.package;
  await ana.client.apps.create({ name: "pipeline", package: kvPackage, org });
  const adminInvite = (
    await ana.client.orgs.inviteCreate(
      { org, role: "admin", teams: undefined, uses: 1 },
      { confirm: passkeyConfirm(ana.passkey) },
    )
  ).token;

  const seed: Seed = { org, owner: ana.accountId, adminInvite, kvPackage };
  mkdirSync(dirname(SEED), { recursive: true });
  writeFileSync(SEED, JSON.stringify(seed));
  return () => cluster?.stop();
}
