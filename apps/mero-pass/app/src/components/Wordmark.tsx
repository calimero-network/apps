import calimeroLogo from '../assets/brand/calimero-logo.svg?raw';

/**
 * The Calimero wordmark, then "Pass" — the lockup every Calimero product uses
 * ("CALIMERO | CLOUD", "CALIMERO | APP REGISTRY"): the landing's own wordmark,
 * a hairline, and the product name as a tracked uppercase label in the
 * accent-text colour.
 *
 * Inlined rather than an <img> so the wordmark takes `currentColor` and follows
 * the theme with no filter; the product name is text so it takes the accent
 * token, which is lime on charcoal and olive on paper.
 */
export default function Wordmark({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span className={`mp-wordmark mp-wordmark--${size} ${className ?? ''}`}>
      <span
        className="mp-wordmark__logo"
        role="img"
        aria-label="Calimero"
        dangerouslySetInnerHTML={{ __html: calimeroLogo }}
      />
      <span className="mp-wordmark__product">Pass</span>
    </span>
  );
}
