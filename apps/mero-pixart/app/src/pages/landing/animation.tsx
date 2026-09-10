/**
 * Mero PixArt hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** Canvas left, layer stack right. A layer toggles and a brush stroke lands. */
export default function PixArtAnimation() {
  const layers = ['0.4s', '0.9s', '1.4s'];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-pane" style={{ left: 18, top: 24, width: 132, bottom: 22 }} />
      {/* the image building up */}
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 32, top: 40, width: 60, height: 46, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.5s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-dot cal-lp-a-in" style={{ left: 84, top: 74, width: 40, height: 40, background: 'var(--cal-lp-border-strong)', ['--d' as string]: '1s', ['--t' as string]: '5.5s' }} />
      {/* brush dabs */}
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="cal-lp-a-dot cal-lp-a-in" style={{ left: 36 + i * 15, top: 126 + (i % 2) * 7, width: 11, height: 11, ['--d' as string]: `${2 + i * 0.16}s`, ['--t' as string]: '5.5s' }} />
      ))}
      {/* layer stack */}
      <span className="cal-lp-a-chip" style={{ right: 18, top: 14 }}>Layers</span>
      {layers.map((d, i) => (
        <span key={`L${i}`} className="cal-lp-a-box cal-lp-a-rise" style={{ right: 18, top: 42 + i * 30, width: 58, height: 24, ['--d' as string]: d, ['--t' as string]: '5.5s' }} />
      ))}
      <span className="cal-lp-a-box cal-lp-a-flash" style={{ right: 18, top: 42, width: 58, height: 24, background: 'transparent', ['--d' as string]: '2.8s', ['--t' as string]: '5.5s' }} />
    </div>
  );
}
