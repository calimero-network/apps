/**
 * Mero Stream hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** Frames leaving one node for another, with the throughput bar it measures. */
export default function StreamAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-pane" style={{ left: 18, top: 30, width: 62, height: 46 }} />
      <span className="cal-lp-a-pane" style={{ right: 18, top: 30, width: 62, height: 46 }} />
      <span className="cal-lp-a-chip" style={{ left: 18, top: 8 }}>Encode</span>
      <span className="cal-lp-a-chip" style={{ right: 18, top: 8 }}>Decode</span>
      {/* fragments crossing */}
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="cal-lp-a-box cal-lp-a-drift"
          style={{
            left: 86, top: 44 + (i % 3) * 9, width: 12, height: 6, borderRadius: 2,
            background: 'var(--cal-lp-accent)', borderColor: 'transparent',
            ['--dx' as string]: '64px', ['--dy' as string]: '0px',
            ['--d' as string]: `${i * 0.42}s`, ['--t' as string]: '2.6s',
          }}
        />
      ))}
      {/* what it exists to measure */}
      <span className="cal-lp-a-chip" style={{ left: 18, top: 100 }}>Throughput</span>
      <span className="cal-lp-a-pane" style={{ left: 18, top: 126, right: 18, height: 10 }} />
      <span className="cal-lp-a-box cal-lp-a-grow" style={{ left: 18, top: 126, width: 150, height: 10, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '0.5s', ['--t' as string]: '5s' }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={`t${i}`} className="cal-lp-a-line" style={{ left: 18 + i * 34, top: 146, width: 2, height: 6 }} />
      ))}
    </div>
  );
}
