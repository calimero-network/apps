/**
 * Mero Design hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it —
 * the animation is the one piece that should differ per app.
 *
 * Composed from the `.cal-lp-a-*` primitives in landing.css, so it themes with
 * the page, pauses under `prefers-reduced-motion`, and reads as a still frame.
 */

/** Shapes fly onto an infinite canvas while a second cursor moves. */
export default function DesignAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 24, top: 26, width: 74, height: 50, ['--d' as string]: '0.3s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 112, top: 26, width: 96, height: 34, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.7s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-dot cal-lp-a-in" style={{ left: 150, top: 84, width: 44, height: 44, background: 'var(--cal-lp-accent-soft)', ['--d' as string]: '1.1s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 24, top: 92, width: 52, height: 52, borderRadius: 26, ['--d' as string]: '1.4s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: 24, top: 158, width: 184, transformOrigin: 'left', ['--d' as string]: '1.8s', ['--t' as string]: '5.5s' }} />
      <span className="cal-lp-a-chip" style={{ right: 18, top: 16 }}>2 editing</span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 96, top: 60, ['--dx' as string]: '58px', ['--dy' as string]: '52px', ['--t' as string]: '5.5s' }} />
    </div>
  );
}
