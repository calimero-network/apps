/**
 * Mero Meet hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** A call grid filling up, with the active speaker's mic bars moving. */
export default function MeetAnimation() {
  const tiles: [number, number, string][] = [[20, 26, '0.3s'], [124, 26, '0.9s'], [20, 108, '1.5s'], [124, 108, '2.1s']];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {tiles.map(([x, y, d], i) => (
        <span key={i} className="cal-lp-a-pane cal-lp-a-rise" style={{ left: x, top: y, width: 96, height: 70, ['--d' as string]: d, ['--t' as string]: '5.5s' }} />
      ))}
      {tiles.map(([x, y, d], i) => (
        <span key={`f${i}`} className="cal-lp-a-dot cal-lp-a-rise" style={{ left: x + 36, top: y + 18, width: 24, height: 24, background: 'var(--cal-lp-border-strong)', ['--d' as string]: d, ['--t' as string]: '5.5s' }} />
      ))}
      {/* mic bars on the active speaker */}
      {[0, 1, 2, 3].map((i) => (
        <span
          key={`m${i}`}
          className="cal-lp-a-box cal-lp-a-blink"
          style={{
            left: 44 + i * 7, top: 78, width: 4, height: 10 + (i % 2) * 8,
            background: 'var(--cal-lp-accent)', borderColor: 'transparent',
            ['--d' as string]: `${2.5 + i * 0.12}s`, ['--t' as string]: '5.5s',
          }}
        />
      ))}
      <span className="cal-lp-a-chip" style={{ right: 18, top: 14 }}>P2P media</span>
    </div>
  );
}
