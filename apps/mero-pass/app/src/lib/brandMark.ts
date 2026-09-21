// ── The brand mark's colours, in ONE place ──────────────────────────────────
//
// ⚠️ THREE PLACES DESCRIBED THE SAME PADLOCK AND THEY HAD DRIFTED:
//
//   scripts/gen-icons.mjs   BG #090b10, FROM #34d399, TO #0d9488
//                           → favicon.svg, apple-touch, icon-192, icon-512
//   public/site.webmanifest background_color #090b10
//   the app bar             near-black on `--accent` (#a5ff11, lime)
//
// So the tab, the bookmark and the installed app showed a teal→green padlock
// on near-black, while the page header showed a near-black padlock on lime —
// inverted, and a different green. Reported as "meropass logo icon in navbar
// has different color background than favicon ico".
//
// These live in TypeScript rather than as CSS custom properties because a
// test can read them: `brandMark.test.ts` compares them to the generator's
// constants and to the shipped favicon, so an icon restyle that forgets the
// header fails in CI. A CSS variable cannot be read that way — Vite
// transforms stylesheets, so a `?raw` import of one comes back empty.
//
// ⚠️ NOT `--accent`. That is the UI accent (lime), for buttons and focus
// rings. The mark is the ICON's, and the two are allowed to differ — but the
// mark must not silently become the accent again.

/** The icon's tile. Same as `BG` in `scripts/gen-icons.mjs`. */
export const MARK_BG = '#090b10';

/** The padlock gradient's light end. Same as `FROM`. */
export const MARK_FROM = '#34d399';

/** The padlock gradient's dark end. Same as `TO`. */
export const MARK_TO = '#0d9488';
