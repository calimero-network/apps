// ── One place that configures pdf.js's worker ───────────────────────────────
//
// ⚠️ THE VERSION CANNOT BE WRITTEN DOWN. It was, twice, and they disagreed:
//
//     pdfService.ts        .../pdf.js/5.3.93/pdf.worker.min.mjs   ← hardcoded
//     embeddingService.ts  .../pdf.js/${pdfjsLib.version}/...
//
// with `pdfjs-dist` at 6.2.108. Loading any document failed with
//
//     PDF loading failed: The API version "6.2.108" does not match the
//     Worker version "5.3.93".
//
// and a `^` range on the dependency means the next bump breaks it again. So
// the worker comes from the INSTALLED package, resolved by the bundler: the
// two versions are the same file's, and they cannot drift.
//
// ⚠️ Also no longer a CDN fetch. `cdnjs.cloudflare.com` at runtime means a
// document that will not open offline, behind a proxy, or inside the desktop
// shell — and a `//cdnjs…` protocol-relative URL is a mixed-content failure
// on any page served over file:. `?url` makes Vite emit it as an asset and
// hand back a local path.
//
// `public/pdf.worker.min.js` is a stale hand-copied 5.3.93 that nothing
// referenced; it is deleted with this change.
import * as pdfjsLib from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let configured = false;

/** Point pdf.js at the worker shipped with the version we import. */
export function configurePdfWorker(): void {
  if (configured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
  configured = true;
}

configurePdfWorker();
