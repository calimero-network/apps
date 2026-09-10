/**
 * Mero Design — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * Shows REAL labels, the way the bespoke previews this replaced did. An
 * abstract rectangle says nothing about what the app is for; "=SUM(A1:A3)" or
 * "Todo / In progress / Done" says it immediately.
 */

const PROJECTS = ['Homepage', 'Dashboard', 'Mobile app'];
const PROPS: [string, string][] = [['Opacity', '100%'], ['W', '240'], ['H', '140']];

/** A canvas with a project sidebar and a properties panel; shapes land on it. */
export default function DesignAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {['V', 'R', 'O', 'T'].map((t, i) => (
        <span key={t} className="cal-lp-a-tool" style={{ left: 20 + i * 21, top: 8 }}>{t}</span>
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 20, top: 13 }}>2 editing</span>

      {/* sidebar */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 38 }}>Projects</span>
      {PROJECTS.map((n, i) => (
        <span key={n} className={`cal-lp-a-txt${i === 1 ? ' cal-lp-a-txt--val' : ''}`} style={{ left: 20, top: 56 + i * 17 }}>{n}</span>
      ))}

      {/* canvas */}
      <span className="cal-lp-a-pane" style={{ left: 92, top: 34, right: 108, bottom: 20, background: 'var(--cal-lp-bg-1)' }} />
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 104, top: 46, width: 62, height: 40, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.4s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-dot cal-lp-a-in" style={{ left: 176, top: 52, width: 30, height: 30, background: 'var(--cal-lp-border-strong)', ['--d' as string]: '1s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-in" style={{ left: 104, top: 100, ['--d' as string]: '1.6s', ['--t' as string]: '6s' }}>Headline</span>
      <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: 104, top: 116, width: 92, transformOrigin: 'left', ['--d' as string]: '2s', ['--t' as string]: '6s' }} />

      {/* properties */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ right: 20, top: 38 }}>Properties</span>
      {/* the fill is a swatch, not a hex string — it has to read at 10px */}
      <span className="cal-lp-a-box" style={{ right: 76, top: 54, width: 12, height: 12, borderRadius: 3, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ right: 20, top: 57 }}>Fill</span>
      {PROPS.map(([k, v], i) => (
        <span key={k}>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 76, top: 76 + i * 16 }}>{k}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ right: 20, top: 76 + i * 16 }}>{v}</span>
        </span>
      ))}
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: 150, top: 70, ['--dx' as string]: '42px', ['--dy' as string]: '44px', ['--t' as string]: '6s' }} />
    </div>
  );
}
