/**
 * Mero Board — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL list names and card titles: "Todo / Doing / Done" with a card
 * dragged across says what the app is for before a word of copy is read.
 * Each card carries the two things the board shows on its face, a checklist
 * count and a due date. The dragged card lands in Doing's empty third slot,
 * so it never covers a card already there.
 *
 * Same geometry as mero-issue-tracker's board (152px column pitch, so list
 * names and card titles fit on one line in a 495px frame).
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const PITCH = 152;
const PANE_W = 142;
const CARD_W = 126;
const CARD_H = 46;
const COL_X = 22;
const CARD_TOP = 48;

const LISTS: [string, [string, string][]][] = [
  ['Todo', [['Draft the launch post', '0/3 · Fri'], ['Book the venue', '1/2 · Mon'], ['Order the banners', '0/1 · Tue']]],
  ['Doing', [['Record the demo', '2/4 · Thu'], ['Update pricing', '1/3 · Wed']]],
  ['Done', [['Pick a launch date', '2/2'], ['Write the press list', '5/5']]],
];

/** Label colours, so the board reads as sorted rather than as a list. */
const LABEL = ['var(--cal-lp-accent)', 'var(--cal-lp-border-strong)', 'var(--cal-lp-border-strong)'];

export default function BoardAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: COL_X + 4, top: 10 }}>Q4 launch</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>marketing · 3 members</span>

      {LISTS.map(([name, cards], ci) => (
        <span key={name}>
          <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: COL_X + 6 + ci * PITCH, top: 30 }}>
            {name}
          </span>
          <span
            className="cal-lp-a-txt cal-lp-a-txt--dim"
            style={{ left: COL_X + ci * PITCH, top: 30, width: PANE_W - 6, textAlign: 'right', fontSize: 8.5 }}
          >
            {cards.length}
          </span>
          <span className="cal-lp-a-pane" style={{ left: COL_X + ci * PITCH, top: 42, width: PANE_W, bottom: 26 }} />
          {cards.map(([title, meta], i) => (
            <span key={title}>
              <span
                className="cal-lp-a-box"
                style={{ left: COL_X + 8 + ci * PITCH, top: CARD_TOP + i * (CARD_H + 8), width: CARD_W, height: CARD_H, borderRadius: 5 }}
              />
              <span
                className="cal-lp-a-dot"
                style={{ left: COL_X + 18 + ci * PITCH, top: CARD_TOP + 10 + i * (CARD_H + 8), width: 5, height: 5, background: LABEL[i % LABEL.length] }}
              />
              <span
                className="cal-lp-a-txt"
                style={{
                  left: COL_X + 28 + ci * PITCH,
                  top: CARD_TOP + 6 + i * (CARD_H + 8),
                  width: CARD_W - 26,
                  whiteSpace: 'normal',
                  fontSize: 9,
                  lineHeight: 1.35,
                }}
              >
                {title}
              </span>
              <span
                className="cal-lp-a-txt cal-lp-a-txt--dim"
                style={{ left: COL_X + 18 + ci * PITCH, top: CARD_TOP + CARD_H - 13 + i * (CARD_H + 8), fontSize: 7.5 }}
              >
                ☑ {meta}
              </span>
            </span>
          ))}
        </span>
      ))}

      {/* The card in motion: Todo → Doing, with a teammate's cursor on it. */}
      <span
        className="cal-lp-a-box cal-lp-a-drift"
        style={{
          left: COL_X + 8,
          top: CARD_TOP + 2 * (CARD_H + 8),
          width: CARD_W,
          height: CARD_H,
          borderRadius: 5,
          background: 'var(--cal-lp-accent-soft)',
          borderColor: 'transparent',
          ['--dx' as string]: `${PITCH}px`,
          ['--dy' as string]: '0px',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-drift"
        style={{
          left: COL_X + 28,
          top: CARD_TOP + 6 + 2 * (CARD_H + 8),
          width: CARD_W - 26,
          whiteSpace: 'normal',
          fontSize: 9,
          lineHeight: 1.35,
          ['--dx' as string]: `${PITCH}px`,
          ['--dy' as string]: '0px',
          ['--t' as string]: '6s',
        }}
      >
        Order the banners
      </span>
      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{
          left: COL_X + 110,
          top: CARD_TOP + 26 + 2 * (CARD_H + 8),
          ['--dx' as string]: `${PITCH}px`,
          ['--dy' as string]: '4px',
          ['--t' as string]: '6s',
        }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: COL_X + 4, bottom: 6, fontSize: 8.5 }}>
        Lists you define · checklists · due dates — on every member’s node
      </span>
    </div>
  );
}
