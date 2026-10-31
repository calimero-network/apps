#!/usr/bin/env node
/**
 * Local development for component apps on core's `merod local`, replacing
 * merobox. Run from the repo root (Node >= 22.18 runs this TypeScript as is):
 *
 *   pnpm dev:local <app>          merod local + build + deploy + the app's Vite dev server
 *   pnpm merod-local up [--fresh] merod local in this terminal (Ctrl-C stops it)
 *   pnpm merod-local deploy <app> build, upload to the running cluster, write the app's
 *                                 .env.development.local, print the frontend URL
 *   pnpm merod-local e2e <app>    the app's scenarios/*.json on the cluster (started
 *                                 fresh when none is running)
 *
 * `--wasm FILE` (deploy, dev, e2e) uses a component built elsewhere (CI's build
 * job) instead of building one. `MEROD_BIN` names the merod binary.
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
  LOCAL_NODES,
  PASSKEY_ORIGIN,
  ROOT,
  STATE_DIR,
  appDir,
  buildComponent,
  healthy,
  scenarioFiles,
  signUp,
  startCluster,
  type Started,
} from "./cluster.ts";
import { runScenario } from "./e2e.ts";

interface Args {
  command: string | undefined;
  app: string | undefined;
  wasm: string | undefined;
  fresh: boolean;
}

function parse(argv: string[]): Args {
  const args: Args = { command: argv[0], app: undefined, wasm: undefined, fresh: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--fresh") args.fresh = true;
    else if (a === "--wasm") args.wasm = argv[++i];
    else if (a?.startsWith("--")) throw new Error(`unknown flag ${a}`);
    else args.app = a;
  }
  return args;
}

function need(app: string | undefined): string {
  if (!app) throw new Error("name the app: e.g. kv-store");
  appDir(app);
  return app;
}

/** Uploads the app's component as a fresh deployer account; returns the bundle hash. */
async function upload(app: string, wasm: string | undefined): Promise<string> {
  const path = wasm ?? buildComponent(app);
  const deployer = await signUp(`deployer-${Date.now().toString(36)}`, LOCAL_NODES[0] as string);
  const bundle = await deployer.client.uploadBundle(new Uint8Array(readFileSync(path)));
  console.log(`• uploaded ${relative(ROOT, path)} as bundle ${bundle}`);
  return bundle;
}

/**
 * `apps/<app>/app/.env.development.local` (gitignored: `*.local`), which Vite's
 * dev server reads: the local nodes and the bundle a signed-in person creates
 * their own instance from. A raw bundle no package ships is visible to every
 * account on the cluster, so the deployer and the person need not be the same.
 */
function writeEnv(app: string, bundle: string): string {
  const path = join(appDir(app), "app", ".env.development.local");
  writeFileSync(
    path,
    [
      "# Written by `pnpm dev:local` / `pnpm merod-local deploy`; regenerated on every deploy.",
      "VITE_CALIMERO_TARGET=local",
      `VITE_CALIMERO_NODES=${LOCAL_NODES.join(",")}`,
      `VITE_CALIMERO_BUNDLE=${bundle}`,
      "",
    ].join("\n"),
  );
  return path;
}

async function deploy(app: string, wasm: string | undefined): Promise<void> {
  if (!(await healthy(LOCAL_NODES[0] as string))) {
    throw new Error("no cluster at 127.0.0.1:2501: run `pnpm merod-local up` first, or `pnpm dev:local <app>`");
  }
  const bundle = await upload(app, wasm);
  const env = writeEnv(app, bundle);
  console.log(`• wrote ${relative(ROOT, env)}`);
  console.log(`\n  ${app}: start its dev server (pnpm --filter ./apps/${app}/app dev) and open ${PASSKEY_ORIGIN}/\n`);
}

async function dev(app: string, wasm: string | undefined, fresh: boolean): Promise<void> {
  let cluster: Started | undefined;
  if (await healthy(LOCAL_NODES[0] as string)) {
    console.log("• using the merod local already running on 127.0.0.1:2501");
  } else {
    const log = join(STATE_DIR, "merod.log");
    console.log(`• starting merod local (log: ${relative(ROOT, log)})`);
    cluster = await startCluster({ fresh, log });
  }
  const bundle = await upload(app, wasm);
  writeEnv(app, bundle);
  // Port 5173 exactly: it is the origin merod local trusts passkey ceremonies from.
  const vite = spawn("pnpm", ["--filter", `./apps/${app}/app`, "dev", "--port", "5173", "--strictPort"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log(`\n  ${app} on merod local: ${PASSKEY_ORIGIN}/  (Ctrl-C stops both)\n`);
  const stop = () => {
    vite.kill("SIGINT");
    cluster?.stop();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  await new Promise<void>((done) => vite.on("exit", () => done()));
  cluster?.stop();
}

async function e2e(app: string, wasm: string | undefined): Promise<void> {
  const files = scenarioFiles(app);
  if (files.length === 0) throw new Error(`apps/${app}/logic/scenarios has no scenario`);
  let cluster: Started | undefined;
  if (!(await healthy(LOCAL_NODES[0] as string))) {
    const log = join(STATE_DIR, "merod.log");
    console.log(`• starting a fresh merod local (log: ${relative(ROOT, log)})`);
    cluster = await startCluster({ fresh: true, log });
  }
  let failed = 0;
  try {
    const bundle = await upload(app, wasm);
    for (const file of files) {
      const name = relative(ROOT, file);
      const started = Date.now();
      try {
        const result = await runScenario(file, bundle);
        const took = `${((Date.now() - started) / 1000).toFixed(1)}s`;
        if (result.status === "skipped") console.log(`SKIP ${name}: ${result.reason}`);
        else console.log(`PASS ${name} (${took})`);
      } catch (error) {
        failed += 1;
        console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    cluster?.stop();
  }
  if (failed > 0) throw new Error(`${failed} of ${files.length} scenarios failed`);
}

async function main(): Promise<void> {
  const args = parse(process.argv.slice(2));
  switch (args.command) {
    case "up": {
      const cluster = await startCluster({ fresh: args.fresh });
      console.log(`• merod local is up: ${LOCAL_NODES.join(", ")} (Ctrl-C stops it)`);
      process.on("SIGINT", () => cluster.stop());
      await new Promise<void>((done) => cluster.child.on("exit", () => done()));
      return;
    }
    case "deploy":
      return deploy(need(args.app), args.wasm);
    case "dev":
      return dev(need(args.app), args.wasm, args.fresh);
    case "e2e":
      return e2e(need(args.app), args.wasm);
    default:
      console.log("usage: merod-local {up [--fresh] | deploy <app> | dev <app> [--fresh] | e2e <app>} [--wasm FILE]");
      process.exitCode = args.command ? 2 : 0;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
