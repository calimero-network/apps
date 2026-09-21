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

// ── Where the signature library is reached from ────────────────────────────
//
// It used to sit on `/workspaces` — the app's ROOT, the list of workspaces you
// belong to — beside "Join a workspace". Your signatures are not a peer of
// your workspaces; they are a tool you reach for while working inside one.
// Reported as "signatures should be inside when we select workspace not added
// in the main application".
//
// ⚠️ The DATA did not move and deliberately so: a signature lives in this
// node's own private context and is the same drawing in every workspace.
// Scoping the store per workspace would mean re-drawing your signature for
// each team, which is not what a signature is.
describe('the signature library', () => {
  const agreements = readFileSync(
    resolve(__dirname, 'AgreementsPage.tsx'),
    'utf8',
  );
  const workspaces = readFileSync(
    resolve(__dirname, 'WorkspacesPage.tsx'),
    'utf8',
  );

  it('is reachable from inside a workspace', () => {
    expect(agreements).toMatch(/data-testid="go-signatures"/);
    expect(agreements).toMatch(/navigate\('\/signatures'\)/);
  });

  it('is NOT on the root workspaces screen', () => {
    expect(workspaces).not.toMatch(/data-testid="go-signatures"/);
    expect(workspaces).not.toMatch(/navigate\('\/signatures'\)/);
  });
});

// ── A stored workspace the node no longer has ──────────────────────────────
//
// The active workspace is remembered in `localStorage` so a reload lands you
// back where you were. A node reset — or a deleted workspace — leaves that id
// pointing at nothing, and it is still a string, so nothing treated it as
// absent: the screen rendered its create box and every action failed against
// a namespace the node does not have. Pressing Create answered with a
// sentence naming `lib/agreements`.
describe('a workspace that is gone', () => {
  const agreements = readFileSync(
    resolve(__dirname, 'AgreementsPage.tsx'),
    'utf8',
  );

  it('is detected from the failed listing, with no extra round trip', () => {
    expect(agreements).toMatch(/setGone\(true\)/);
  });

  it('drops the stored selection rather than reporting it forever', () => {
    expect(agreements).toMatch(/setActiveWorkspace\(null\)/);
  });

  it('offers the picker instead of a create box that cannot work', () => {
    const gone = agreements.indexOf('if (gone)');
    const create = agreements.indexOf('data-testid="create-agreement"');
    expect(gone).toBeGreaterThan(-1);
    // The dead-workspace return comes FIRST, so the create box is unreachable.
    expect(gone).toBeLessThan(create);
  });
});

// ── A transient failure is not a dead workspace ────────────────────────────
//
// ⚠️ THE FIRST VERSION OF THIS GOT IT WRONG, and Cursor Bugbot caught it: any
// `listAgreements` failure set `gone` and wiped the remembered workspace. A
// dropped connection, a 500 or a timeout therefore deleted a perfectly good
// selection and showed "That workspace is not on this node" — worst on the
// reconnect where you would most want it back.
//
// Being GONE has to come from the node, not from a failure.
describe('declaring a workspace gone', () => {
  const page = readFileSync(resolve(__dirname, 'AgreementsPage.tsx'), 'utf8');

  it('asks the node which workspaces it has, before deciding', () => {
    expect(page).toMatch(/listWorkspaces\(adminApi\(\), applicationId\)/);
  });

  it('keeps the selection when the check itself cannot run', () => {
    // No app id, or the check throwing, must both bail BEFORE `setGone`.
    const guardA = page.indexOf('if (!applicationId) return;');
    const guardB = page.indexOf('if (!known) return;');
    const present = page.indexOf(
      'known.some((w) => w.namespaceId === workspaceId)',
    );
    const gone = page.indexOf('setGone(true)');
    for (const [name, at] of [
      ['applicationId guard', guardA],
      ['failed-check guard', guardB],
      ['present guard', present],
    ] as const) {
      expect(at, `${name} missing`).toBeGreaterThan(-1);
      expect(at, `${name} must precede setGone`).toBeLessThan(gone);
    }
  });

  it('never forgets a workspace the URL asked for', () => {
    // An id in the route is the person's instruction, not our cache.
    expect(page).toMatch(
      /if \(!params\.workspaceId\) setActiveWorkspace\(null\);/,
    );
  });
});
