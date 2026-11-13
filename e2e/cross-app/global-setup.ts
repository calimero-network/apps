/**
 * Starts `merod local --fresh` trusting the three dev servers' origins (and
 * the nodes' own pages under `localhost`, for the consent page), and builds
 * the two packages the suite's org holds: Chat and KV Store, each a
 * dev-signed `.mpk` (`mero-component bundle --dev`). Chat's carries its
 * frontend, built for merod local, so the cluster serves it on Chat's own
 * origin (chat-bound-session.spec.ts). A package is installed per account,
 * so the specs install them; nobody's org is made here: each spec makes its
 * own in Chat, in the browser.
 *
 * Needs core's app-team routes (core#4890, #4891), first released in
 * 1.0.0-rc.14; an older merod is refused here with that reason.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  LOCAL_NODES,
  ROOT,
  healthy,
  signUp,
  startCluster,
} from "../../packages/merod-local/src/cluster.ts";

import { NODE_PAGES, ORIGINS } from "./origins.ts";

/** Where the setup hands the built packages to the spec: beside the cluster's state (gitignored). */
export const SEED = join(ROOT, ".merod-local", "cross-app-e2e-seed.json");

export interface Seed {
  chatMpk: string;
  kvMpk: string;
}

/**
 * `apps/<app>/logic` as a dev-signed `.mpk` in the root `dist/`, built unless
 * it is there already (Home's e2e builds the same KV Store file). With
 * `frontend`, the app's frontend is built first (a production build against
 * merod local) and packed, always afresh so the page served is this tree's.
 */
function devBundle(app: string, pkg: string, frontend = false): string {
  const out = join(ROOT, "dist", `${pkg}-dev${frontend ? "-served" : ""}.mpk`);
  if (!frontend) {
    try {
      readFileSync(out);
      return out;
    } catch {
      /* not built yet */
    }
  } else {
    execFileSync("pnpm", ["exec", "vite", "build"], {
      cwd: join(ROOT, "apps", app, "app"),
      stdio: "inherit",
      env: { ...process.env, VITE_CALIMERO_TARGET: "local", VITE_CALIMERO_BUNDLE: "" },
    });
  }
  execFileSync(
    "cargo",
    [
      "run",
      "--release",
      "--manifest-path",
      "tools/component-bundle/Cargo.toml",
      "--",
      "bundle",
      `apps/${app}/logic`,
      "--dev",
      ...(frontend ? [] : ["--no-frontend"]),
      "--output",
      out,
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  return out;
}

export default async function globalSetup(): Promise<() => void> {
  const running = await healthy(LOCAL_NODES[0]!);
  if (running) {
    console.warn(
      `• using the merod local already on ${LOCAL_NODES[0]}: it must trust ${[...Object.values(ORIGINS), ...NODE_PAGES].join(", ")} ` +
        "(merod local --origins), or the KV Store steps cannot sign in",
    );
  }
  const cluster = running
    ? null
    : await startCluster({
        fresh: true,
        log: join(ROOT, ".merod-local", "cross-app-e2e.log"),
        origins: [...Object.values(ORIGINS), ...NODE_PAGES],
      });
  try {
    const probe = await signUp("Probe", LOCAL_NODES[0]!);
    const org = (await probe.client.orgs.create({ name: "probe" })).orgId;
    try {
      await probe.client.orgs.appTeamList({ org });
    } catch (e) {
      throw new Error(
        `this merod has no app-team routes (GET /orgs/{org}/app-teams answered ${String(e)}): ` +
          "the cross-app e2e needs core 1.0.0-rc.14 or later (core#4890 and #4891)",
      );
    }
    const seed: Seed = {
      chatMpk: devBundle("mero-chat", "com.calimero.chat", true),
      kvMpk: devBundle("kv-store", "com.calimero.kv-store"),
    };
    mkdirSync(dirname(SEED), { recursive: true });
    writeFileSync(SEED, JSON.stringify(seed));
  } catch (e) {
    cluster?.stop();
    throw e;
  }
  return () => cluster?.stop();
}
