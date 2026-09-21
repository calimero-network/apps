import { MARK_FROM, MARK_TO } from '../lib/brandMark';
/**
 * The Mero Pass mark: a padlock.
 *
 * ⚠️ THE SAME GEOMETRY AS `public/favicon.svg`, and that is the point. The app
 * bar used to render the character `●` — a bullet — while the favicon, the
 * apple-touch icon, the 192/512 PWA icons and the manifest all showed a
 * padlock. So the tab, the bookmark, the installed app and the home screen
 * were one product and the page header was another.
 *
 * Drawn as a path rather than an <img> so it can inherit the page's own
 * colour tokens — but those tokens are now the ICON's (`--mark-bg`,
 * `--mark-from`, `--mark-to`), kept identical to `scripts/gen-icons.mjs`.
 * It previously painted the padlock near-black on `--accent` (lime) while
 * every generated icon showed it as a teal→green gradient on near-black:
 * inverted, and a different green.
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
      fill="none"
    >
      {/* The icon's own gradient, in the icon's own direction. `currentColor`
          is the fallback if a renderer drops the gradient. */}
      <defs>
        <linearGradient
          id="mero-pass-mark"
          x1="13"
          y1="16"
          x2="51"
          y2="54"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor={MARK_FROM} />
          <stop offset="1" stopColor={MARK_TO} />
        </linearGradient>
      </defs>
      {/* The shackle. */}
      <path
        d="M21.5 27a10.5 10.5 0 0 1 21 0"
        stroke="url(#mero-pass-mark)"
        strokeWidth="6"
        strokeLinecap="round"
      />
      {/* The body, and the keyhole knocked out of it. */}
      <rect
        x="13"
        y="26"
        width="38"
        height="28"
        rx="7"
        fill="url(#mero-pass-mark)"
      />
      <circle cx="32" cy="37" r="4.5" className="keyhole" />
      <path d="M29.8 37h4.4l-1.1 10h-2.2z" className="keyhole" />
    </svg>
  );
}
