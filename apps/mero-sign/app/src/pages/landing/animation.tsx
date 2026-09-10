/**
 * Mero Sign hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** A PDF page; two signature fields fill in turn, then it verifies. */
export default function SignAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-pane" style={{ left: 46, top: 18, width: 148, bottom: 18, background: 'var(--cal-lp-bg-1)' }} />
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="cal-lp-a-line" style={{ left: 60, top: 34 + i * 15, width: i === 4 ? 62 : 118 }} />
      ))}
      {/* two signature slots */}
      <span className="cal-lp-a-box" style={{ left: 60, top: 108, width: 56, height: 26 }} />
      <span className="cal-lp-a-box" style={{ left: 126, top: 108, width: 56, height: 26 }} />
      <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: 66, top: 124, width: 44, height: 4, background: 'var(--cal-lp-accent)', transformOrigin: 'left', ['--d' as string]: '0.8s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: 132, top: 124, width: 44, height: 4, background: 'var(--cal-lp-accent)', transformOrigin: 'left', ['--d' as string]: '2.2s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-chip cal-lp-a-rise" style={{ left: 60, top: 146, ['--d' as string]: '3.4s', ['--t' as string]: '5.5s' }}>Verified</span>
    </div>
  );
}
