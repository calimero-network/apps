import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// ── The page has to render in the browsers people actually have ───────────
//
// pdfjs-dist 6's default build calls `Map.prototype.getOrInsertComputed`, a
// method only the newest engines ship. Everywhere else (Chromium before 145,
// current Safari, older desktop webviews) opening a document fetched it,
// parsed it, and then failed to draw the page:
//
//     TypeError: y(...).getOrInsertComputed is not a function
//         at getOptionalContentConfig
//
// which the viewer reported as "Failed to render PDF pages.", with the Sign
// button unreachable behind it. The legacy build carries the polyfills.
//
// The test removes both features before importing the app's pdf.js, so it
// shows whether the build brings them whatever Node runs it (22 lacks them,
// 24 has them).

const require = createRequire(import.meta.url);

/** One blank page; the smallest document pdf.js will open. */
function tinyPdf(): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('the pdf.js build the app loads', () => {
  it('brings the engine features it relies on, and draws a page', async () => {
    const map = Map.prototype as { getOrInsertComputed?: unknown };
    const promise = Promise as { try?: unknown };
    const had = {
      getOrInsertComputed: Object.getOwnPropertyDescriptor(map, 'getOrInsertComputed'),
      try: Object.getOwnPropertyDescriptor(promise, 'try'),
    };
    delete map.getOrInsertComputed;
    delete promise.try;
    expect([typeof map.getOrInsertComputed, typeof promise.try]).toEqual([
      'undefined',
      'undefined',
    ]);

    // Node has no DOMMatrix, which pdf.js's canvas module touches as it is
    // imported. Nothing here draws to a canvas, so an empty stand-in is enough
    // to get to the calls under test; imported late so it exists first.
    const g = globalThis as { DOMMatrix?: unknown };
    g.DOMMatrix ??= class DOMMatrix {};
    const { pdfjsLib } = await import('./pdfjs');

    // The main thread is where the reported TypeError was thrown.
    expect([typeof map.getOrInsertComputed, typeof promise.try]).toEqual([
      'function',
      'function',
    ]);

    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
      require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
    ).href;
    const task = pdfjsLib.getDocument({ data: tinyPdf() });
    try {
      const doc = await task.promise;
      expect(doc.numPages).toBe(1);
      const page = await doc.getPage(1);
      // What `render()` asks for first: the per-intent state behind the
      // operator list, which is the lookup that threw.
      await expect(page.getOperatorList()).resolves.toBeTruthy();
    } finally {
      await task.destroy();
      // Back to what the host runtime had, so other tests see it unchanged.
      for (const [key, target] of [['getOrInsertComputed', map], ['try', promise]] as const) {
        const d = had[key];
        if (d) Object.defineProperty(target, key, d);
        else delete (target as Record<string, unknown>)[key];
      }
    }
  });
});
