/**
 * Mero Org — a minimal mock of the app itself: the activity log, four rows.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const ROW_X = 22;
const ROW_W = 451;
const ROW_H = 40;
const ROW_TOP = 48;
const GAP = 12;

const ROWS: [string, string, string][] = [
  ['Ana invited', 'admin · just now', 'var(--cal-lp-accent)'],
  ['Ana · Engineering', 'member added to group', 'var(--cal-lp-border-strong)'],
  ['Engineering → Drive', 'group reaches app', 'var(--cal-lp-border-strong)'],
  ['Ana placed in Drive', 'reconciler · private subgroup', 'var(--cal-lp-accent)'],
];

export default function MeroOrgAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: ROW_X + 4, top: 14 }}>Activity</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 22, top: 14 }}>4 rows · chain intact</span>

      {ROWS.map(([title, sub, colour], i) => {
        const top = ROW_TOP + i * (ROW_H + GAP);
        return (
          <span key={title}>
            <span
              className="cal-lp-a-box"
              style={{ left: ROW_X, top, width: ROW_W, height: ROW_H, borderRadius: 6 }}
            />
            <span
              className="cal-lp-a-dot"
              style={{ left: ROW_X + 14, top: top + 17, width: 6, height: 6, background: colour }}
            />
            <span className="cal-lp-a-txt" style={{ left: ROW_X + 30, top: top + 7, fontSize: 10 }}>{title}</span>
            <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: ROW_X + 30, top: top + 23, fontSize: 8.5 }}>{sub}</span>
            <span
              className="cal-lp-a-txt cal-lp-a-txt--dim"
              style={{ right: 34, top: top + 14, fontSize: 8 }}
            >
              #{i + 1} · {['a3f9', 'c71e', '09bd', 'e482'][i]}
            </span>
          </span>
        );
      })}

      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{
          left: ROW_X + 300,
          top: ROW_TOP + 10,
          ['--dx' as string]: '0px',
          ['--dy' as string]: `${3 * (ROW_H + GAP)}px`,
          ['--t' as string]: '6s',
        }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: ROW_X + 4, bottom: 6, fontSize: 8.5 }}>
        Each row hashes the one before it
      </span>
    </div>
  );
}
