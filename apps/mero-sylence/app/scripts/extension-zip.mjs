// The extension download, as the Cloud node's page links it: the built
// `../extension/dist` zipped under one `sylence/` folder, its manifest `key`
// kept (it pins the extension's id, so the sign-in callback works for a
// "Load unpacked" install). The same zip `extensionDownload.ts` serves beside
// the page in development; a node serves no `.zip`, so the Release workflow
// attaches this one to the `sylence-extension` GitHub release instead.
//
//   pnpm -F mero-sylence-extension build && node apps/mero-sylence/app/scripts/extension-zip.mjs out.zip
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const dist = join(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");
const out = process.argv[2];
if (!out) {
  console.error("usage: extension-zip.mjs <out.zip>");
  process.exit(2);
}
if (!existsSync(join(dist, "manifest.json"))) {
  console.error(`no built extension at ${dist}: run pnpm -F mero-sylence-extension build`);
  process.exit(1);
}
const files = {};
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[`sylence/${relative(dist, path).split("\\").join("/")}`] = readFileSync(path);
  }
};
walk(dist);
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`wrote ${out}`);
