/**
 * Mero Sign — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

/** A PDF with two named signatories; each signs in turn, then it verifies. */
export default function SignAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Supplier agreement.pdf</span>
      <span className="cal-lp-a-pane" style={{ left: 40, top: 28, right: 40, bottom: 18, background: 'var(--cal-lp-bg-1)' }} />
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="cal-lp-a-line" style={{ left: 54, top: 40 + i * 13, width: i === 3 ? 58 : 112 }} />
      ))}
      {/* two signature slots with names */}
      {[
        ['Ana', 56, '0.9s'],
        ['Marko', 130, '2.4s'],
      ].map(([name, x, d]) => (
        <span key={name as string}>
          <span className="cal-lp-a-box" style={{ left: x as number, top: 100, width: 62, height: 28 }} />
          <span className="cal-lp-a-line cal-lp-a-grow" style={{ left: (x as number) + 8, top: 116, width: 46, height: 4, background: 'var(--cal-lp-accent)', transformOrigin: 'left', ['--d' as string]: d as string, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: x as number, top: 132, fontSize: 8.5 }}>{name}</span>
        </span>
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-rise" style={{ right: 44, top: 132, ['--d' as string]: '3.8s', ['--t' as string]: '6s' }}>Verified peer-to-peer</span>
    </div>
  );
}
