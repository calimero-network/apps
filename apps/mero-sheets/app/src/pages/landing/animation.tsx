/**
 * Mero Sheets — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "=SUM(B2:B8)"
 * says it immediately.
 *
 * ⚠️ A FULL grid, deliberately. This used to draw three columns and four rows
 * with six cells filled, which left two thirds of the frame empty and looked
 * like a spreadsheet that had just been created rather than one being used.
 * Every cell now carries a value, because the thing being advertised is a
 * working sheet.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx, which scales the whole box to whatever the frame is.
 */

const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const CW = 72;
const RH = 25;
const GRID_X = 40;
const GRID_Y = 62;

/** Header, six data rows, and a totals row — the shape of a real budget sheet. */
const ROWS: string[][] = [
  ['Item', 'Q1', 'Q2', 'Q3', 'Q4', 'Year'],
  ['Wages', '1 200', '1 240', '1 190', '1 300', '4 930'],
  ['Rent', '900', '900', '900', '900', '3 600'],
  ['Cloud', '310', '348', '402', '455', '1 515'],
  ['Travel', '120', '80', '260', '140', '600'],
  ['Misc', '95', '110', '75', '130', '410'],
  ['Legal', '200', '0', '150', '0', '350'],
  ['Support', '140', '155', '160', '175', '630'],
  ['Total', '2 965', '2 833', '3 137', '3 100', '12 035'],
];

/**
 * The handful of cells that light up as they are edited, keyed "col,row".
 *
 * ⚠️ Applied to the cell's OWN box. Drawing a separate filled box on top is
 * what the first version did, and an opaque overlay hid the very value it was
 * highlighting — four cells rendered blank.
 */
const FILLS: Record<string, string> = {
  '1,2': '0.5s',
  '2,3': '1.0s',
  '3,5': '1.5s',
  '4,4': '2.0s',
};

export default function SheetsAnimation() {
  const cells = [];

  for (let r = 0; r < ROWS.length; r += 1) {
    const isHead = r === 0;
    const isTotal = r === ROWS.length - 1;
    for (let c = 0; c < COLS.length; c += 1) {
      const x = GRID_X + c * CW;
      const y = GRID_Y + r * RH;
      const text = ROWS[r][c];
      const numeric = c > 0;
      const fill = FILLS[`${c},${r}`];
      cells.push(
        <span
          key={`b${r}-${c}`}
          className={`cal-lp-a-box${fill ? ' cal-lp-a-fill' : ''}`}
          style={{
            left: x,
            top: y,
            width: CW - 1,
            height: RH - 1,
            borderRadius: 2,
            background: isHead || isTotal ? 'var(--cal-lp-bg-2)' : undefined,
            ...(fill ? { ['--d' as string]: fill, ['--t' as string]: '6s' } : null),
          }}
        />,
        <span
          key={`t${r}-${c}`}
          className={`cal-lp-a-txt ${isHead ? 'cal-lp-a-txt--head' : isTotal ? 'cal-lp-a-txt--val' : ''}`}
          style={{
            left: numeric ? x + 4 : x + 6,
            top: y + 8,
            width: CW - 11,
            textAlign: numeric ? 'right' : 'left',
            fontSize: 9.5,
            color: isTotal && c === COLS.length - 1 ? 'var(--cal-lp-accent-ink)' : undefined,
          }}
        >
          {text}
        </span>,
      );
    }
  }

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-av" style={{ left: 20, top: 8 }}>A</span>
      <span className="cal-lp-a-av" style={{ left: 40, top: 8, background: 'var(--cal-lp-border-strong)', color: 'var(--cal-lp-text)' }}>M</span>
      <span className="cal-lp-a-av" style={{ left: 60, top: 8, background: 'var(--cal-lp-bg-3)', color: 'var(--cal-lp-text-dim)' }}>I</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 84, top: 13 }}>3 collaborators</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 13 }}>live</span>

      {/* The formula bar: the one element that says "spreadsheet" on sight. */}
      <span className="cal-lp-a-box" style={{ left: 20, top: 30, right: 20, height: 18, borderRadius: 3 }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 27, top: 36, fontSize: 9 }}>fx</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ left: 44, top: 36, fontSize: 9.5, ['--d' as string]: '2.6s', ['--t' as string]: '6s' }}>
        =SUM(B2:B8)
      </span>

      {COLS.map((l, i) => (
        <span key={l} className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: GRID_X + i * CW, top: 54, width: CW - 1, textAlign: 'center' }}>
          {l}
        </span>
      ))}
      {ROWS.map((_, i) => (
        <span key={`rn${i}`} className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 22, top: GRID_Y + i * RH + 8, width: 14, textAlign: 'right', fontSize: 9 }}>
          {i + 1}
        </span>
      ))}

      {cells}

      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 128, top: 118, ['--dx' as string]: '150px', ['--dy' as string]: '74px', ['--t' as string]: '6s' }} />
      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{ left: 330, top: 190, background: 'var(--cal-lp-border-strong)', ['--dx' as string]: '-118px', ['--dy' as string]: '-52px', ['--t' as string]: '6s' }}
      />
    </div>
  );
}
