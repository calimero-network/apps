/**
 * Mero Blocks — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const S = 24;

/** A voxel world being built; blocks place, one breaks, a second player digs. */
export default function BlocksAnimation() {
  const rows: [number, number, string | null][] = [
    [0, 2, null], [1, 2, null], [2, 2, null], [3, 2, null], [4, 2, null],
    [1, 1, null], [2, 1, '0.9s'], [3, 1, null],
    [2, 0, '2.1s'], [3, 0, '3.0s'],
  ];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>World · seed 4821</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>2 players</span>
      {rows.map(([c, r, d], i) => (
        <span
          key={i}
          className={d ? 'cal-lp-a-box cal-lp-a-in' : 'cal-lp-a-box'}
          style={{
            left: 40 + c * S + r * 8, top: 122 - r * S, width: S - 2, height: S - 2,
            background: r === 2 ? 'var(--cal-lp-bg-3)' : 'var(--cal-lp-accent-soft)',
            ...(d ? { ['--d' as string]: d, ['--t' as string]: '6s' } : {}),
          }}
        />
      ))}
      <span className="cal-lp-a-av" style={{ left: 150, top: 62 }}>M</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 150, top: 84, fontSize: 8.5 }}>Marko</span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 120, top: 78, ['--dx' as string]: '-38px', ['--dy' as string]: '26px', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Seed + edits, no game server</span>
    </div>
  );
}
