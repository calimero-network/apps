// Fails the build if the editor stack re-enters the eager load graph, or if
// the eager payload exceeds its budget.
//
// Guards a regression that shipped silently: an object-form `manualChunks`
// let Rollup merge shared modules into `vendor-blocknote`, so the entry chunk
// statically imported it and index.html preloaded it. The `lazy()` boundary
// around DocumentEditor was still in the source and still looked correct.
//
// Run against a completed build: `pnpm build && pnpm check:bundle`.

import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not `.pathname`: the latter keeps percent-encoding, so a
// checkout under a path with a space resolves to a directory that does not
// exist and the check fails for the wrong reason.
const BUILD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const INDEX = join(BUILD_DIR, 'index.html');

// Chunks that must never be reachable by static import from the entry. These
// are demand-loaded behind a route or component boundary.
const MUST_BE_LAZY = ['vendor-blocknote'];

// Eager JS budget, gzipped. Set with headroom over the current figure, but
// far below what re-including the editor stack would cost, so this fails on
// that specific regression rather than nagging about ordinary growth.
const EAGER_GZIP_BUDGET_KB = 400;

if (!existsSync(INDEX)) {
  console.error(`No build found at ${INDEX}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const html = readFileSync(INDEX, 'utf8');

// Entry scripts plus anything the browser is told to fetch up front.
const eagerSeeds = [
  ...html.matchAll(/<script[^>]+type="module"[^>]+src="([^"]+)"/g),
  ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g),
]
  .map((m) => m[1])
  .filter((href) => href.endsWith('.js'));

if (eagerSeeds.length === 0) {
  console.error('Parsed no eager module scripts from index.html. Bailing rather than passing vacuously.');
  process.exit(1);
}

// Walk static imports transitively. A chunk reachable this way is downloaded
// and evaluated before the app can start, whatever the source looks like.
const seen = new Set();
const queue = eagerSeeds.map((h) => basename(h));
// Any chunk named by index.html that we cannot find on disk means the walk is
// looking in the wrong place, and an unwalked graph reports an empty eager set
// — a pass on whatever it failed to inspect. Fail instead of guessing.
const missing = [];

while (queue.length > 0) {
  const file = queue.pop();
  if (seen.has(file)) continue;
  seen.add(file);

  const path = join(BUILD_DIR, 'assets', file);
  if (!existsSync(path)) {
    missing.push(file);
    continue;
  }
  const src = readFileSync(path, 'utf8');

  for (const m of src.matchAll(/from"\.\/([^"]+\.js)"/g)) queue.push(m[1]);
  for (const m of src.matchAll(/import"\.\/([^"]+\.js)"/g)) queue.push(m[1]);
}

let failed = false;

if (missing.length > 0) {
  console.error(
    `FAIL  ${missing.length} chunk(s) referenced by index.html were not found under ` +
      `${join(BUILD_DIR, 'assets')}:\n      ${missing.join('\n      ')}\n` +
      `      The import walk cannot see them, so this check would report an empty ` +
      `eager graph and pass vacuously. Has build.assetsDir changed?`,
  );
  failed = true;
}

for (const name of MUST_BE_LAZY) {
  const hit = [...seen].find((f) => f.startsWith(name));
  if (hit) {
    console.error(
      `FAIL  ${hit} is in the eager graph but must be demand-loaded.\n` +
        `      Something the entry imports was merged into it. Check ` +
        `manualChunks in vite.config.js — shared modules (vite's preload ` +
        `helper, clsx) must be pinned to an eager chunk so Rollup cannot ` +
        `fold them into a lazy one.`,
    );
    failed = true;
  }
}

let totalGzip = 0;
const rows = [];
for (const file of [...seen].sort()) {
  const path = join(BUILD_DIR, 'assets', file);
  if (!existsSync(path)) continue;
  const gz = gzipSync(readFileSync(path)).length;
  totalGzip += gz;
  rows.push([file, gz]);
}

const totalKb = totalGzip / 1024;
console.log('Eager JS chunks (gzip):');
for (const [file, gz] of rows.sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(gz / 1024).toFixed(1).padStart(7)} kB  ${file}`);
}
console.log(`  ${totalKb.toFixed(1).padStart(7)} kB  TOTAL (budget ${EAGER_GZIP_BUDGET_KB} kB)`);

// A zero total means nothing was actually measured, whatever the reason.
if (totalGzip === 0) {
  console.error('FAIL  measured 0 bytes of eager JS. Refusing to report a pass.');
  failed = true;
}

if (totalKb > EAGER_GZIP_BUDGET_KB) {
  console.error(
    `FAIL  eager JS is ${totalKb.toFixed(1)} kB gzipped, over the ${EAGER_GZIP_BUDGET_KB} kB budget.`,
  );
  failed = true;
}

if (failed) process.exit(1);
console.log('OK    editor stack is demand-loaded and eager JS is within budget.');
