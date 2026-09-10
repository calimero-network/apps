/**
 * Mero Blocks hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Composed from the `.cal-lp-a-*` primitives in landing.css.
 */

const S = 26;

/** An isometric-ish stack of blocks; some place, one breaks, a second player digs. */
export default function BlocksAnimation() {
  const blocks: [number, number, string | null][] = [
    [0, 2, null], [1, 2, null], [2, 2, null], [3, 2, null],
    [0, 1, null], [1, 1, '0.6s'], [2, 1, null],
    [1, 0, '1.4s'], [2, 0, '2.2s'],
  ];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {blocks.map(([c, r, d], i) => (
        <span
          key={i}
          className={d ? 'cal-lp-a-box cal-lp-a-in' : 'cal-lp-a-box'}
          style={{
            left: 44 + c * S + r * 9,
            top: 128 - r * S,
            width: S - 2,
            height: S - 2,
            background: r === 2 ? 'var(--cal-lp-bg-3)' : 'var(--cal-lp-accent-soft)',
            ...(d ? { ['--d' as string]: d, ['--t' as string]: '5s' } : {}),
          }}
        />
      ))}
      <span className="cal-lp-a-chip" style={{ left: 20, top: 12 }}>Seed 4821</span>
      <span className="cal-lp-a-chip" style={{ right: 18, top: 12 }}>2 players</span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 128, top: 74, ['--dx' as string]: '-40px', ['--dy' as string]: '34px', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-line" style={{ left: 20, top: 158, right: 20, height: 4 }} />
    </div>
  );
}
