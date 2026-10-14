// ── The one pdf.js import in the app ───────────────────────────────────────
//
// ⚠️ THE LEGACY BUILD, ON PURPOSE. pdfjs-dist 6's default build assumes
// `Map.prototype.getOrInsertComputed` and `Promise.try`, which only the newest
// engines ship. Everywhere else (Chromium before 145, current Safari, older
// desktop webviews) a document downloaded and parsed, and then drawing its
// first page threw
//
//     TypeError: y(...).getOrInsertComputed is not a function
//
// so the viewer showed "Failed to render PDF pages." and the Sign button never
// appeared. The legacy build is the same version with those polyfilled.
//
// The worker must come from the same build; see `./pdfWorker`. Import pdf.js
// from here, never from 'pdfjs-dist' directly, so the two cannot drift apart.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

export { pdfjsLib };
