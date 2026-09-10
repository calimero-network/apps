/**
 * Mero Forum — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const THREADS: [string, string, string][] = [
  ['Should we pin the SDK per app?', '7 replies', '0.4s'],
  ['Node keeps dropping on wifi', '3 replies', '1.0s'],
  ['Welcome thread', '12 replies', '1.6s'],
];

/** A thread list with real titles; a reply arrives and nests. */
export default function ForumAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Engineering</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Invite only</span>
      {THREADS.map(([title, meta, d], i) => (
        <span key={title}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 30 + i * 38, right: 20, height: 32, ...(i === 0 ? { background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent' } : {}), ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 30, top: 38 + i * 38, ['--d' as string]: d, ['--t' as string]: '6s' }}>{title}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 30, top: 50 + i * 38, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{meta}</span>
        </span>
      ))}
      {/* the nested reply landing */}
      <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 44, top: 144, right: 20, height: 26, ['--d' as string]: '2.6s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-av cal-lp-a-rise" style={{ left: 54, top: 149, ['--d' as string]: '2.6s', ['--t' as string]: '6s' }}>A</span>
      <span className="cal-lp-a-txt cal-lp-a-rise" style={{ left: 78, top: 154, fontSize: 8.5, ['--d' as string]: '2.6s', ['--t' as string]: '6s' }}>Agreed — pin it in the catalog.</span>
    </div>
  );
}
