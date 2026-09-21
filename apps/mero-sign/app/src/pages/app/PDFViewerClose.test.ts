import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Every early return needs a way out ─────────────────────────────────────
//
// `PDFViewer`'s close button lives in the main render path, reached only once
// a PDF has loaded. Its loading, error and no-file branches had NO close
// control — so a document that failed to load (which, with the worker-version
// mismatch, was every document) opened a modal that could not be dismissed.
const src = readFileSync(
  resolve(__dirname, '../../components/PDFViewer.tsx'),
  'utf8',
);

describe('PDFViewer early returns', () => {
  it('offers the same escape hatch in every one of them', () => {
    // Defined once, rendered in loading, error and no-file.
    expect(src).toMatch(/const escapeHatch =/);
    expect(src.match(/\{escapeHatch\}/g) ?? []).toHaveLength(3);
  });

  it('the hatch actually calls onClose', () => {
    expect(src).toMatch(/escapeHatch =[\s\S]{0,400}?onClick=\{onClose\}/);
  });
});
