/**
 * Mero Drive Docs hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** A folder of documents; one uploads, then seals. */
export default function DriveAnimation() {
  const rows = ['0.3s', '0.7s', '1.1s', '1.5s'];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-chip" style={{ left: 20, top: 14 }}>Product / specs</span>
      {rows.map((d, i) => (
        <span key={i} className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 42 + i * 30, right: 20, height: 24, ['--d' as string]: d, ['--t' as string]: '5s' }} />
      ))}
      {rows.map((d, i) => (
        <span key={`l${i}`} className="cal-lp-a-line cal-lp-a-rise" style={{ left: 32, top: 52 + i * 30, width: 60 + (i % 3) * 26, ['--d' as string]: d, ['--t' as string]: '5s' }} />
      ))}
      {/* the upload filling, then a lock chip */}
      <span className="cal-lp-a-box cal-lp-a-grow" style={{ left: 20, top: 162, right: 20, height: 5, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '1.9s', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-chip cal-lp-a-rise" style={{ right: 20, top: 138, ['--d' as string]: '3.1s', ['--t' as string]: '5s' }}>Encrypted</span>
    </div>
  );
}
