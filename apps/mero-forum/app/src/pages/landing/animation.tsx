/**
 * Mero Forum hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** A thread list: a new post arrives on top, then a reply nests under it. */
export default function ForumAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 18, right: 20, height: 40, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.4s', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-line cal-lp-a-rise" style={{ left: 34, top: 28, width: 118, ['--d' as string]: '0.5s', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-line cal-lp-a-rise" style={{ left: 34, top: 42, width: 72, height: 5, ['--d' as string]: '0.6s', ['--t' as string]: '5s' }} />
      {/* the nested reply */}
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 44, top: 66, right: 20, height: 30, ['--d' as string]: '1.6s', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-line cal-lp-a-rise" style={{ left: 58, top: 76, width: 94, ['--d' as string]: '1.7s', ['--t' as string]: '5s' }} />
      {[0, 1].map((i) => (
        <span key={i} className="cal-lp-a-box" style={{ left: 20, top: 106 + i * 34, right: 20, height: 28 }} />
      ))}
      {[0, 1].map((i) => (
        <span key={`t${i}`} className="cal-lp-a-line" style={{ left: 34, top: 116 + i * 34, width: 106 - i * 24 }} />
      ))}
      <span className="cal-lp-a-chip cal-lp-a-blink" style={{ right: 20, top: 24, ['--t' as string]: '5s' }}>+1 reply</span>
    </div>
  );
}
