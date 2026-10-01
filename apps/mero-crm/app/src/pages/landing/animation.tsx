/**
 * Mero Issue Tracker — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "Todo / In
 * progress / Done" says it immediately.
 *
 * ⚠️ Sized to the frame. A 74px column pitch was narrower than the words
 * "In progress" — so the headers ran together and every card wrapped to two
 * words a line — and three of those columns filled 60% of the width. At 152px
 * the titles fit on one line and the board uses the frame it is given.
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

const COLS: [string, string[]][] = [
  ['Todo', ['Sync drops on reconnect', 'Invite link 404s', 'Key delivery races join']],
  ['In progress', ['Blob upload stalls', 'Docs deep link 404s']],
  ['Done', ['Fix stale cursor', 'Pin the SDK version']],
];

/** Priority dot colours, so the board reads as triaged rather than as a list. */
const PRIORITY = ['var(--cal-lp-accent)', 'var(--cal-lp-border-strong)', 'var(--cal-lp-border-strong)'];

export default function IssueTrackerAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: COL_X + 4, top: 10 }}>Board</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>4 members · 7 open</span>

      {COLS.map(([name, cards], ci) => (
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
          {cards.map((t, i) => (
            <span key={t}>
              <span
                className="cal-lp-a-box"
                style={{ left: COL_X + 8 + ci * PITCH, top: CARD_TOP + i * (CARD_H + 8), width: CARD_W, height: CARD_H, borderRadius: 5 }}
              />
              <span
                className="cal-lp-a-dot"
                style={{ left: COL_X + 18 + ci * PITCH, top: CARD_TOP + 10 + i * (CARD_H + 8), width: 5, height: 5, background: PRIORITY[i % PRIORITY.length] }}
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
                {t}
              </span>
              <span
                className="cal-lp-a-txt cal-lp-a-txt--dim"
                style={{ left: COL_X + 18 + ci * PITCH, top: CARD_TOP + CARD_H - 13 + i * (CARD_H + 8), fontSize: 7.5 }}
              >
                #{ci * 4 + i + 12} · repro ✓
              </span>
            </span>
          ))}
        </span>
      ))}

      {/* The card in motion: Todo → In progress, with a peer's cursor on it. */}
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
          ['--dy' as string]: `${-(CARD_H + 8)}px`,
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
          ['--dy' as string]: `${-(CARD_H + 8)}px`,
          ['--t' as string]: '6s',
        }}
      >
        Key delivery races join
      </span>
      <span
        className="cal-lp-a-cursor cal-lp-a-drift"
        style={{
          left: COL_X + 110,
          top: CARD_TOP + 26 + 2 * (CARD_H + 8),
          ['--dx' as string]: `${PITCH}px`,
          ['--dy' as string]: `${-(CARD_H + 4)}px`,
          ['--t' as string]: '6s',
        }}
      />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: COL_X + 4, bottom: 6, fontSize: 8.5 }}>
        Summary · impact · repro · resolution criteria — on every issue
      </span>
    </div>
  );
}
