/**
 * The Mero Pass mark: a padlock.
 *
 * ⚠️ THE SAME GEOMETRY AS `public/favicon.svg`, and that is the point. The app
 * bar used to render the character `●` — a bullet — while the favicon, the
 * apple-touch icon, the 192/512 PWA icons and the manifest all showed a
 * padlock. So the tab, the bookmark, the installed app and the home screen
 * were one product and the page header was another.
 *
 * Drawn as a path rather than an <img> of the favicon: the mark sits on the
 * accent fill and has to be inked in `--accent-ink`, because near-black on
 * that green is the app's contrast rule — white measures ~1.2:1 against it.
 * An <img> would carry the favicon's own dark tile and its teal gradient into
 * a 22px green square, which is how a brand ends up with two greens.
 *
 * Shape kept in step with `scripts/gen-icons.mjs`, which generates every other
 * icon in `public/` from the same 64×64 design space.
 */
export default function BrandMark() {
  return (
    <svg
      viewBox="0 0 64 64"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
      // `currentColor` so the one ink rule in `.mark` governs this too.
      fill="none"
      stroke="currentColor"
    >
      {/* The shackle. */}
      <path
        d="M21.5 27a10.5 10.5 0 0 1 21 0"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* The body, and the keyhole knocked out of it. */}
      <rect x="13" y="26" width="38" height="28" rx="7" fill="currentColor" />
      <circle cx="32" cy="37" r="4.5" className="keyhole" />
      <path d="M29.8 37h4.4l-1.1 10h-2.2z" className="keyhole" />
    </svg>
  );
}
