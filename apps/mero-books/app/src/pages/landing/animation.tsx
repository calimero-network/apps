/**
 * Mero Books — a minimal mock of the app itself: the bank reconcile screen.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Real labels, like the other previews: statement lines on the left, what the
 * books recorded on the right, and the match between them. The moment that
 * moves is the one people open the app for — a line turning green as it
 * reconciles.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const LEFT = 22;
const RIGHT = 262;
const COL_W = 212;
const ROW_H = 54;
const TOP = 64;

const ROWS: Array<[string, string, string, string]> = [
  // statement date, statement text, amount, what the books recorded
  ['12 Mar', 'ACME LTD  INV-0007', '+2,400.00', 'Payment · INV-0007 · Acme Ltd'],
  ['13 Mar', 'CLOUD HOSTING', '−89.00', 'Spend money · Hosting'],
  ['14 Mar', 'NORTHWIND PAYROLL', '+1,150.00', 'Payment · INV-0009 · Northwind'],
  ['15 Mar', 'BANK FEE', '−4.50', 'Create · Bank Fees'],
];

export default function BooksAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: LEFT + 4, top: 10 }}>Business Bank Account</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Balance 18,240.50</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LEFT + 4, top: 40 }}>Bank statement</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: RIGHT + 4, top: 40 }}>In Mero Books</span>

      {ROWS.map(([date, text, amount, match], i) => {
        const top = TOP + i * ROW_H;
        // The first row is the one being reconciled, so it pulses green.
        const live = i === 0;
        return (
          <span key={text}>
            <span className="cal-lp-a-box" style={{ left: LEFT, top, width: COL_W, height: ROW_H - 10 }} />
            <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LEFT + 10, top: top + 7, fontSize: 8 }}>{date}</span>
            <span className="cal-lp-a-txt" style={{ left: LEFT + 10, top: top + 19, fontSize: 9.5 }}>{text}</span>
            <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: LEFT, top: top + 19, width: COL_W - 10, textAlign: 'right', fontSize: 9.5 }}>
              {amount}
            </span>

            <span
              className={`cal-lp-a-box${live ? ' cal-lp-a-flash' : ''}`}
              style={{
                left: RIGHT, top, width: COL_W, height: ROW_H - 10,
                background: i < 3 ? 'var(--cal-lp-accent-soft)' : undefined,
                borderColor: i < 3 ? 'transparent' : undefined,
                ['--t' as string]: '3.2s',
              }}
            />
            <span className="cal-lp-a-txt" style={{ left: RIGHT + 10, top: top + 13, width: COL_W - 60, fontSize: 9 }}>{match}</span>
            <span className="cal-lp-a-chip" style={{ left: RIGHT + COL_W - 44, top: top + 10, fontSize: 8.5 }}>
              {i < 3 ? 'OK' : 'Code'}
            </span>
          </span>
        );
      })}

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: LEFT + 4, bottom: 6, fontSize: 8.5 }}>
        Double entry underneath · every report derived from posted transactions
      </span>
    </div>
  );
}
