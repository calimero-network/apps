import { describe, expect, it } from 'vitest';
// ── The mark is one mark ───────────────────────────────────────────────────
//
// ⚠️ THREE PLACES DESCRIBE THE SAME PADLOCK and they had all drifted:
//
//   scripts/gen-icons.mjs   BG #090b10, FROM #34d399, TO #0d9488
//                           -> favicon.svg, apple-touch, icon-192, icon-512
//   public/site.webmanifest background_color #090b10
//   the app bar             near-black on `--accent` (#a5ff11, lime)
//
// So the tab, the bookmark and the installed app showed a teal→green padlock
// on near-black, and the page header showed a near-black padlock on lime —
// inverted, and a different green. Reported as "meropass logo icon in navbar
// has different color background than favicon ico".
//
// This pins them together: the CSS tokens the header paints with must BE the
// generator's constants. A future icon restyle that forgets the header fails
// here.

// ⚠️ `?raw` IMPORTS, not `node:fs`. This app's `tsconfig.app.json` declares
// `types: ["vite/client", "vitest/globals"]` and no `@types/node`, so neither
// `__dirname` nor `node:fs` typechecks here — `pnpm typecheck` fails even
// though vitest runs them fine. `?raw` is Vite's own, typed by `vite/client`,
// and it also makes these four files real dependencies of the test: change
// one and the test re-runs.
import gen from '../../scripts/gen-icons.mjs?raw';
import favicon from '../../public/favicon.svg?raw';
import manifestRaw from '../../public/site.webmanifest?raw';
import { MARK_BG, MARK_FROM, MARK_TO } from './brandMark';

const manifest = JSON.parse(manifestRaw) as { background_color: string };

/** `const NAME = "#rrggbb";` out of the generator. */
function genColor(name: string): string {
  const m = gen.match(
    new RegExp(`const ${name}\\s*=\\s*["'](#[0-9a-fA-F]{6})["']`),
  );
  expect(m, `gen-icons.mjs has no ${name}`).not.toBeNull();
  return m![1].toLowerCase();
}

describe('the brand mark', () => {
  it('guards against a vacuous pass', () => {
    // Without this, a renamed constant makes every assertion below compare
    // nothing to nothing.
    expect(gen).toContain('const BG');
    expect(MARK_BG).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('paints the header tile in the icon background', () => {
    expect(MARK_BG.toLowerCase()).toBe(genColor('BG'));
  });

  it('paints the header padlock in the icon gradient', () => {
    expect(MARK_FROM.toLowerCase()).toBe(genColor('FROM'));
    expect(MARK_TO.toLowerCase()).toBe(genColor('TO'));
  });

  it('is NOT the UI accent, which is what the mismatch was', () => {
    // The accent (#a5ff11, lime) belongs to buttons and focus rings. The mark
    // is the icon's, and the two are allowed to differ — but the mark must
    // not silently become the accent again, which is what it was.
    expect(MARK_BG.toLowerCase()).not.toBe('#a5ff11');
    expect(MARK_FROM.toLowerCase()).not.toBe('#a5ff11');
  });

  it('agrees with the favicon and the manifest that ship to users', () => {
    expect(favicon).toContain(genColor('BG'));
    expect(favicon.toLowerCase()).toContain(genColor('FROM'));
    expect(favicon.toLowerCase()).toContain(genColor('TO'));
    expect(String(manifest.background_color).toLowerCase()).toBe(
      genColor('BG'),
    );
  });
});
