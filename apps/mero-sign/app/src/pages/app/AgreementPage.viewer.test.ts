import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── The viewer is never mounted without bytes ──────────────────────────────
//
// `PDFViewer` renders
//
//     No PDF selected. Please upload a PDF to get started.
//
// whenever its `file` prop is null. `AgreementPage` used to pass `file={null}`
// outright, so opening any document showed that copy forever — it blamed the
// reader for the app never having asked for the bytes.
//
// ⚠️ THE FIRST FIX WAS NOT ENOUGH, which is why this test exists. Fetching
// the blob and passing `file={viewingFile}` still leaves the viewer mounted
// with null WHILE the download is in flight, and again AFTER a failure —
// where it sat underneath the real error, contradicting it. So the property
// is not "we pass a file", it is "the viewer is not mounted until there is
// one".
//
// A SOURCE test because this app's vitest runs in `node` with no
// testing-library, so there is no way to render the page here. Same approach
// as `src/routes.test.ts`, which asserts on the routing source for the same
// reason — and the property is about what the file is allowed to contain,
// which is a thing source can answer honestly.

const page = readFileSync(resolve(__dirname, 'AgreementPage.tsx'), 'utf8');

describe('the document viewer', () => {
  it('is mounted exactly once', () => {
    expect(page.match(/<PDFViewer/g) ?? []).toHaveLength(1);
  });

  it('is never handed a null file', () => {
    // The original bug, in one line.
    expect(page).not.toMatch(/<PDFViewer[\s\S]{0,200}?file=\{null\}/);
  });

  it('is handed the fetched bytes', () => {
    expect(page).toMatch(/<PDFViewer[\s\S]{0,200}?file=\{viewingFile\}/);
  });

  it('is behind a guard on those bytes, so the empty state cannot flash', () => {
    // The mount has to sit in the branch where `viewingFile` is known set.
    // Without this, a slow node shows "No PDF selected" on every open.
    const guard = page.indexOf('!viewingFile ?');
    const mount = page.indexOf('<PDFViewer');
    expect(guard, 'no `!viewingFile` guard before the viewer').toBeGreaterThan(
      -1,
    );
    expect(mount).toBeGreaterThan(guard);
  });

  it('says what failed instead of falling back to the empty state', () => {
    expect(page).toMatch(/data-testid="document-error"/);
    expect(page).toMatch(/data-testid="document-loading"/);
  });
});

describe('the viewer modal can always be dismissed', () => {
  it('closes on Escape', () => {
    // Independent of whatever the viewer is rendering.
    expect(page).toMatch(/e\.key === 'Escape'/);
    expect(page).toMatch(/window\.addEventListener\('keydown'/);
  });

  it('closes on a backdrop click, and not on a click inside the panel', () => {
    expect(page).toMatch(/data-testid="document-backdrop"/);
    expect(page).toMatch(/e\.stopPropagation\(\)/);
  });
});
