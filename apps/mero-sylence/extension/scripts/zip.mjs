// Zips dist/ for the Chrome Web Store (and Brave, which installs from it):
// `pnpm -F mero-sylence-extension build && pnpm -F mero-sylence-extension zip`.
// The store assigns its own key, so the upload leaves out the manifest's `key`
// (it pins the ID only for unpacked development builds).
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/manifest.json is missing: run the build first");
  process.exit(1);
}
const stage = mkdtempSync(join(tmpdir(), "sylence-zip-"));
cpSync(dist, stage, { recursive: true });
const manifestPath = join(stage, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const keepKey = process.argv.includes("--keep-key");
if (!keepKey) delete manifest.key;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const zip = join(root, `sylence-${manifest.version}.zip`);
rmSync(zip, { force: true });
execFileSync("zip", ["-qr", zip, "."], { cwd: stage, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
console.log(`wrote ${zip}${keepKey ? "" : " (without the development key)"}`);
