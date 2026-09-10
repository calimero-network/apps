/**
 * Mero Issue Tracker — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "=SUM(A1:A3)" or
 * "Todo / In progress / Done" says it immediately.
 */

const COLS: [string, string[]][] = [
  ['Todo', ['Sync drops on reconnect', 'Invite link 404s']],
  ['In progress', ['Blob upload stalls']],
  ['Done', ['Fix stale cursor']],
];

/** A board with real issue titles; one card walks Todo to In progress. */
export default function IssueTrackerAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {COLS.map(([name, cards], ci) => (
        <span key={name}>
          <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20 + ci * 74, top: 12 }}>{name}</span>
          <span className="cal-lp-a-pane" style={{ left: 18 + ci * 74, top: 30, width: 68, bottom: 18 }} />
          {cards.map((t, i) => (
            <span key={t}>
              <span className="cal-lp-a-box" style={{ left: 23 + ci * 74, top: 38 + i * 40, width: 58, height: 34 }} />
              <span className="cal-lp-a-txt" style={{ left: 28 + ci * 74, top: 46 + i * 40, width: 48, whiteSpace: 'normal', fontSize: 8.5, lineHeight: 1.25 }}>{t}</span>
            </span>
          ))}
        </span>
      ))}
      {/* the card in motion */}
      <span className="cal-lp-a-box cal-lp-a-drift" style={{ left: 23, top: 118, width: 58, height: 34, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--dx' as string]: '74px', ['--dy' as string]: '-40px', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-drift" style={{ left: 28, top: 126, width: 48, whiteSpace: 'normal', fontSize: 8.5, lineHeight: 1.25, ['--dx' as string]: '74px', ['--dy' as string]: '-40px', ['--t' as string]: '6s' }}>Key delivery races join</span>
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 78, top: 128, ['--dx' as string]: '74px', ['--dy' as string]: '-36px', ['--t' as string]: '6s' }} />
    </div>
  );
}
