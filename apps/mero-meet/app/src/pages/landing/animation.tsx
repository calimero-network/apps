/**
 * Mero Meet — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const PEOPLE = ['Ana', 'Marko', 'Iva', 'You'];

/** A call grid of named participants; the speaker's mic bars move. */
export default function MeetAnimation() {
  const pos: [number, number][] = [[20, 30], [124, 30], [20, 108], [124, 108]];
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Standup · 4 in call</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>P2P media</span>
      {PEOPLE.map((who, i) => (
        <span key={who}>
          <span className="cal-lp-a-pane cal-lp-a-rise" style={{ left: pos[i][0], top: pos[i][1], width: 96, height: 66, ['--d' as string]: `${0.3 + i * 0.5}s`, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: pos[i][0] + 39, top: pos[i][1] + 16, ...(i === 3 ? {} : { background: 'var(--cal-lp-border-strong)', color: 'var(--cal-lp-text)' }), ['--d' as string]: `${0.3 + i * 0.5}s`, ['--t' as string]: '6s' }}>{who[0]}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: pos[i][0] + 8, top: pos[i][1] + 50, fontSize: 8.5, ['--d' as string]: `${0.3 + i * 0.5}s`, ['--t' as string]: '6s' }}>{who}</span>
        </span>
      ))}
      {/* the active speaker's mic */}
      {[0, 1, 2, 3].map((i) => (
        <span key={`m${i}`} className="cal-lp-a-box cal-lp-a-blink" style={{ left: 88 + i * 6, top: 76 - (i % 2) * 3, width: 3, height: 8 + (i % 2) * 7, background: 'var(--cal-lp-accent)', borderColor: 'transparent', ['--d' as string]: `${2.4 + i * 0.1}s`, ['--t' as string]: '6s' }} />
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Signalling on your nodes · media direct</span>
    </div>
  );
}
