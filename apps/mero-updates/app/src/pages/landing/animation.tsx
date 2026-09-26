/**
 * Mero Updates — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels: an update with KPI tiles, an ask with an investor's
 * offer arriving, and reactions and a reply landing — the two-way half is the
 * thing being advertised, so it is what animates in last.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const KPIS = [
  { name: 'MRR', value: '$48k', delta: '+14%', d: '0.8s' },
  { name: 'Customers', value: '31', delta: '+6', d: '1.1s' },
  { name: 'Runway', value: '19 mo', delta: '+1', d: '1.4s' },
];

const rise = (d: string) => ({ ['--d' as string]: d, ['--t' as string]: '7s' });

export default function UpdatesAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 12 }}>Acme · All investors</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 12 }}>📅 Monthly update</span>

      {/* The update. */}
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 32, right: 20, height: 46, ...rise('0.3s') }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 32, top: 40, fontSize: 12, ...rise('0.3s') }}>
        June 2026 update
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 32, top: 58, fontSize: 8.5, ...rise('0.3s') }}>
        TL;DR — first enterprise customer, two senior hires, runway past 18 months.
      </span>

      {/* KPI tiles, each with the change since the last report. */}
      {KPIS.map((k, i) => {
        const left = 20 + i * 154;
        return (
          <span key={k.name}>
            <span className="cal-lp-a-box cal-lp-a-rise" style={{ left, top: 86, width: 146, height: 50, ...rise(k.d) }} />
            <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: left + 10, top: 93, fontSize: 7.5, ...rise(k.d) }}>
              {k.name.toUpperCase()}
            </span>
            <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: left + 10, top: 105, fontSize: 14, ...rise(k.d) }}>
              {k.value}
            </span>
            <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ left: left + 90, top: 110, fontSize: 9, ...rise(k.d) }}>
              {k.delta}
            </span>
          </span>
        );
      })}

      {/* An ask, and the offer that answers it. */}
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 146, right: 20, height: 56, ...rise('1.8s') }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 32, top: 153, fontSize: 8, ...rise('1.8s') }}>
        🤝 INTRO
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 32, top: 166, fontSize: 10, ...rise('1.8s') }}>
        Intro to a CFO at a Series B fintech
      </span>
      <span
        className="cal-lp-a-box cal-lp-a-rise"
        style={{ left: 32, top: 182, width: 78, height: 14, borderRadius: 5, background: 'var(--cal-lp-accent)', borderColor: 'transparent', ...rise('1.8s') }}
      />
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 32, top: 185, width: 78, textAlign: 'center', fontSize: 7.5, fontWeight: 650, color: 'var(--cal-lp-accent-text)', ...rise('1.8s') }}>
        🙋 I can help
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ left: 122, top: 185, fontSize: 8, ...rise('3.2s') }}>
        ✓ Ben (Seed Fund) offered to help
      </span>

      {/* Reactions and a reply — the investors answering back. */}
      {['🎉 4', '🚀 2', '👀 3'].map((r, i) => (
        <span key={r}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20 + i * 46, top: 212, width: 40, height: 18, borderRadius: 9, ...rise(`${2.4 + i * 0.3}s`) }} />
          <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 20 + i * 46, top: 216, width: 40, textAlign: 'center', fontSize: 8.5, ...rise(`${2.4 + i * 0.3}s`) }}>
            {r}
          </span>
        </span>
      ))}

      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 238, right: 20, height: 30, ...rise('3.8s') }} />
      <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: 30, top: 244, ...rise('3.8s') }}>D</span>
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 56, top: 249, fontSize: 8.5, ...rise('3.8s') }}>
        Dee: Congrats on the enterprise deal — who ran procurement?
      </span>
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 50, top: 274, right: 20, height: 30, ...rise('4.6s') }} />
      <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: 60, top: 280, background: 'var(--cal-lp-accent)', color: 'var(--cal-lp-accent-text)', ...rise('4.6s') }}>A</span>
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 86, top: 285, fontSize: 8.5, ...rise('4.6s') }}>
        Ana (Team): Their CFO directly — happy to share the playbook.
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: 316, fontSize: 8.5 }}>
        👁 7 of 9 investors read · 2 offers · next update due in 26 days
      </span>
    </div>
  );
}
