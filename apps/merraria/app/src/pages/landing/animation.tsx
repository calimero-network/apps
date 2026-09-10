/**
 * Merraria — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const T = 17;

/** A side-on world being mined; a shaft goes down while another player digs. */
export default function MerrariaAnimation() {
  const cols = 10;
  const rows = 4;
  const mined: Record<string, string> = { '3-0': '0.6s', '3-1': '1.3s', '3-2': '2.0s', '7-0': '2.7s', '7-1': '3.4s' };
  const tiles = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const key = `${c}-${r}`;
      const d = mined[key];
      tiles.push(
        <span
          key={key}
          className={d ? 'cal-lp-a-box cal-lp-a-blink' : 'cal-lp-a-box'}
          style={{
            left: 22 + c * T, top: 66 + r * T, width: T - 2, height: T - 2, borderRadius: 2,
            background: d ? 'transparent' : r === 0 ? 'var(--cal-lp-accent-soft)' : 'var(--cal-lp-bg-3)',
            ...(d ? { ['--d' as string]: d, ['--t' as string]: '6s' } : {}),
          }}
        />,
      );
    }
  }
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>World · seed 1907</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Offline ok</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 22, top: 44, fontSize: 8.5 }}>surface</span>
      {tiles}
      <span className="cal-lp-a-av cal-lp-a-drift" style={{ left: 74, top: 48, ['--dx' as string]: '0px', ['--dy' as string]: '34px', ['--t' as string]: '6s' }}>Y</span>
      <span className="cal-lp-a-av cal-lp-a-drift" style={{ left: 142, top: 48, background: 'var(--cal-lp-border-strong)', color: 'var(--cal-lp-text)', ['--dx' as string]: '0px', ['--dy' as string]: '20px', ['--t' as string]: '6s' }}>M</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Seed + tile edits, no game server</span>
    </div>
  );
}
