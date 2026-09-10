/**
 * Mero Pass hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** A vault of masked secrets; one reveals, then re-masks. */
export default function PassAnimation() {
  const rows = ['0.4s', '0.9s', '1.4s', '1.9s'];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-chip" style={{ left: 20, top: 14 }}>Team vault</span>
      {rows.map((d, i) => (
        <span key={i} className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 42 + i * 32, right: 20, height: 26, ['--d' as string]: d, ['--t' as string]: '5s' }} />
      ))}
      {/* masked values: a run of dots per row */}
      {rows.map((d, r) =>
        Array.from({ length: 6 }, (_, i) => (
          <span
            key={`${r}-${i}`}
            className="cal-lp-a-dot cal-lp-a-rise"
            style={{
              left: 120 + i * 9, top: 52 + r * 32, width: 5, height: 5,
              background: 'var(--cal-lp-border-strong)', ['--d' as string]: d, ['--t' as string]: '5s',
            }}
          />
        )),
      )}
      {/* the one that reveals */}
      <span className="cal-lp-a-line cal-lp-a-in" style={{ left: 120, top: 82, width: 62, height: 6, background: 'var(--cal-lp-accent)', ['--d' as string]: '2.6s', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-line" style={{ left: 32, top: 52, width: 52 }} />
      <span className="cal-lp-a-line" style={{ left: 32, top: 84, width: 38 }} />
      <span className="cal-lp-a-line" style={{ left: 32, top: 116, width: 46 }} />
      <span className="cal-lp-a-line" style={{ left: 32, top: 148, width: 30 }} />
    </div>
  );
}
