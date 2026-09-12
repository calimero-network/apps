/**
 * Mero Calendar — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "=SUM(A1:A3)" or
 * "Todo / In progress / Done" says it immediately.
 */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
/* Wide enough for the longest event label: at 40 `Design review` ran straight
   under Thursday's column. */
const W = 62;

/** A week with named events; one is private and never leaves the node. */
export default function CalendarAnimation() {
  const events: [number, number, number, string, string, boolean][] = [
    [0, 44, 24, 'Standup', '0.4s', false],
    [2, 62, 32, 'Design review', '1.0s', false],
    [1, 96, 22, 'Retro', '1.6s', false],
    [3, 50, 40, 'Focus', '2.2s', true],
    [4, 80, 26, '1:1', '2.8s', false],
  ];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>This week</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Team · 4 members</span>
      {DAYS.map((d, i) => (
        <span key={d}>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 22 + i * W, top: 28 }}>{d}</span>
          <span className="cal-lp-a-pane" style={{ left: 20 + i * W, top: 40, width: W - 4, bottom: 18 }} />
        </span>
      ))}
      {events.map(([col, top, h, label, d, priv], i) => (
        <span key={i}>
          <span
            className="cal-lp-a-box cal-lp-a-rise"
            style={{
              left: 22 + col * W, top, width: W - 8, height: h,
              background: priv ? 'var(--cal-lp-bg-3)' : 'var(--cal-lp-accent-soft)',
              borderColor: priv ? 'var(--cal-lp-border-strong)' : 'transparent',
              borderStyle: priv ? 'dashed' : 'solid',
              ['--d' as string]: d, ['--t' as string]: '6s',
            }}
          />
          <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 25 + col * W, top: top + 6, fontSize: 8, ['--d' as string]: d, ['--t' as string]: '6s' }}>{label}</span>
        </span>
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Dashed = private, never replicated</span>
    </div>
  );
}
