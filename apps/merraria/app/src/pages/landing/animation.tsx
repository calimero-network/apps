/**
 * Merraria hero animation.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Composed from the `.cal-lp-a-*` primitives in landing.css.
 */

const T = 18;

/** A side-on tile world; a shaft is mined down and a second player digs elsewhere. */
export default function MerrariaAnimation() {
  const cols = 10;
  const rows = 5;
  const mined = new Set(['3-0', '3-1', '3-2', '6-0', '6-1']);
  const delays: Record<string, string> = { '3-0': '0.5s', '3-1': '1.1s', '3-2': '1.7s', '6-0': '2.3s', '6-1': '2.9s' };
  const tiles = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = `${c}-${r}`;
      const isMined = mined.has(key);
      tiles.push(
        <span
          key={key}
          className={isMined ? 'cal-lp-a-box cal-lp-a-blink' : 'cal-lp-a-box'}
          style={{
            left: 20 + c * T, top: 74 + r * T, width: T - 2, height: T - 2, borderRadius: 2,
            background: isMined ? 'transparent' : r === 0 ? 'var(--cal-lp-accent-soft)' : 'var(--cal-lp-bg-3)',
            borderColor: isMined ? 'var(--cal-lp-border)' : undefined,
            ...(isMined ? { ['--d' as string]: delays[key], ['--t' as string]: '5s' } : {}),
          }}
        />,
      );
    }
  }
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-chip" style={{ left: 20, top: 14 }}>Seed 1907</span>
      <span className="cal-lp-a-chip" style={{ right: 18, top: 14 }}>Offline ok</span>
      {tiles}
      {/* the two diggers */}
      <span className="cal-lp-a-dot cal-lp-a-drift" style={{ left: 74, top: 60, width: 10, height: 10, ['--dx' as string]: '0px', ['--dy' as string]: '38px', ['--t' as string]: '5s' }} />
      <span className="cal-lp-a-dot cal-lp-a-drift" style={{ left: 128, top: 60, width: 10, height: 10, background: 'var(--cal-lp-border-strong)', ['--dx' as string]: '0px', ['--dy' as string]: '22px', ['--t' as string]: '5s' }} />
    </div>
  );
}
