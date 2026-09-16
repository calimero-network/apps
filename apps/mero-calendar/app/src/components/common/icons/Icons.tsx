/**
 * The app's icon set — inline SVG, one stroke weight, one grid.
 *
 * ⚠️ Replaces two things that did not belong in the UI:
 *
 *   1. A 🔒 EMOJI as the "private event" marker. An emoji is rendered by the
 *      platform's colour font, so it ignored `currentColor` and every theme
 *      token — a saturated yellow padlock sat inside otherwise-themed event
 *      chips, at a size and baseline that differed per OS.
 *   2. Font Awesome 5.11.2, pulled from a CDN in `index.html` for EIGHT
 *      glyphs. A blocking third-party stylesheet on first paint, for icons a
 *      few hundred bytes of markup can draw — and FA5's `fa-eye` is a heavy
 *      filled lozenge that read as a warning rather than "view only".
 *
 * All icons:
 *   - are 24×24 viewBox, drawn as strokes, so weight stays even at any size;
 *   - take their colour from `currentColor`, so they theme for free;
 *   - default to 1em, so they scale with the text they sit beside;
 *   - are `aria-hidden` unless given a `title`, because most of them sit next
 *     to a text label that already names the action.
 */
import type { FC, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  /** Edge length; anything CSS accepts. Defaults to `1em`. */
  size?: number | string;
  /** Accessible name. Omit when an adjacent text label already provides one. */
  title?: string;
}

/**
 * Shared chrome for every glyph below.
 *
 * `strokeWidth` is on the <svg>, not the paths, so a caller can thicken a whole
 * icon with one prop without touching geometry.
 */
const Svg: FC<IconProps & { children: React.ReactNode }> = ({
  size = "1em",
  title,
  children,
  ...rest
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? "img" : undefined}
    aria-hidden={title ? undefined : true}
    focusable="false"
    {...rest}
  >
    {title ? <title>{title}</title> : null}
    {children}
  </svg>
);

/** Private event — node-local storage, never replicated. */
export const LockIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    <circle cx="12" cy="15.2" r="1.15" fill="currentColor" stroke="none" />
  </Svg>
);

/**
 * View-only.
 *
 * ⚠️ Deliberately an outlined eye with a hairline pupil, not FA5's filled
 * `fa-eye`. At 14px the filled version collapsed into a solid blob that read
 * as an alert badge; the whole point of this icon is to say "you may look at
 * this but not change it", which is a quiet statement.
 */
export const EyeIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M2.6 12S6 5.9 12 5.9 21.4 12 21.4 12 18 18.1 12 18.1 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </Svg>
);

/** Edit — the pencil, for an event you own. */
export const EditIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 20h4.2L19.3 8.9a2.1 2.1 0 0 0 0-3l-1.2-1.2a2.1 2.1 0 0 0-3 0L4 15.8V20Z" />
    <path d="M14.4 5.9 18.1 9.6" />
  </Svg>
);

/** Delete. */
export const TrashIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4 6.6h16" />
    <path d="M9.4 6.6V4.9a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v1.7" />
    <path d="M6.2 6.6 7 19a1.6 1.6 0 0 0 1.6 1.5h6.8A1.6 1.6 0 0 0 17 19l.8-12.4" />
    <path d="M10.3 10.4v6M13.7 10.4v6" />
  </Svg>
);

/** Close / dismiss. */
export const CloseIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
  </Svg>
);

export const ChevronLeftIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const ChevronRightIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Svg>
);

export const ChevronDownIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M5.5 9 12 15.5 18.5 9" />
  </Svg>
);

export const CheckIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M4.8 12.6 9.6 17.4 19.2 6.6" />
  </Svg>
);

/** A team member holding the admin role. */
export const ShieldIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M12 3.2 19.2 6v5.4c0 4.3-2.9 7.6-7.2 9.4-4.3-1.8-7.2-5.1-7.2-9.4V6L12 3.2Z" />
    <path d="M9.2 11.9 11.4 14l3.6-4" />
  </Svg>
);

/** An ordinary team member. */
export const UserIcon: FC<IconProps> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8.4" r="3.6" />
    <path d="M5.2 20c0-3.3 3-5.6 6.8-5.6s6.8 2.3 6.8 5.6" />
  </Svg>
);
