/**
 * The browser extension, zipped, served beside the page at
 * `minutes-extension.zip`: the landing page's download. Until Minutes is in
 * the Chrome Web Store, people install it with "Load unpacked"; the zip is the
 * built `../extension/dist`, whose manifest `key` keeps the extension's id, so
 * its sign-in callback works the same as a store install.
 *
 * In development the zip is made on each request from whatever `dist` holds
 * (`pnpm -F mero-minutes-extension build`); a build emits it as an asset and
 * fails without a built extension, so a release never ships a page whose
 * download is missing.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { zipSync } from "fflate";
import type { Plugin } from "vite";

export const ZIP_NAME = "minutes-extension.zip";

function files(dir: string, root = dir, out: Record<string, Uint8Array> = {}): Record<string, Uint8Array> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, root, out);
    else out[`minutes/${relative(root, path).split("\\").join("/")}`] = readFileSync(path);
  }
  return out;
}

/** The zip of a built extension at `dist`, everything under one `minutes/` folder. */
export function zipExtension(dist: string): Uint8Array {
  if (!existsSync(join(dist, "manifest.json"))) {
    throw new Error(`no built extension at ${dist}: run pnpm -F mero-minutes-extension build`);
  }
  return zipSync(files(dist), { level: 9 });
}

/** The extension's version, from its package.json. */
export function extensionVersion(extensionDir: string): string {
  return (JSON.parse(readFileSync(join(extensionDir, "package.json"), "utf8")) as { version: string }).version;
}

export function extensionDownload(extensionDir = resolve(__dirname, "../extension")): Plugin {
  const dist = join(extensionDir, "dist");
  return {
    name: "minutes-extension-download",
    config: () => ({ define: { __EXTENSION_VERSION__: JSON.stringify(extensionVersion(extensionDir)) } }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.split("?")[0]!.endsWith(`/${ZIP_NAME}`)) return next();
        try {
          const zip = zipExtension(dist);
          res.setHeader("Content-Type", "application/zip");
          res.setHeader("Content-Disposition", `attachment; filename="${ZIP_NAME}"`);
          res.end(Buffer.from(zip));
        } catch (e) {
          res.statusCode = 404;
          res.end(e instanceof Error ? e.message : String(e));
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: ZIP_NAME, source: zipExtension(dist) });
    },
  };
}
