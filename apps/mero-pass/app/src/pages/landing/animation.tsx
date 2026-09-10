/**
 * Mero Pass — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const SECRETS: [string, string, string][] = [
  ['GitHub', 'login', '0.4s'],
  ['Deploy key', 'ssh', '1.0s'],
  ['Stripe', 'totp', '1.6s'],
  ['Wifi', 'note', '2.2s'],
];

/** A vault of named secrets; one reveals then re-masks. */
export default function PassAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Team vault</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>3 members</span>
      {SECRETS.map(([name, kind, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 32 + i * 32, right: 20, height: 26, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 30, top: 41 + i * 32, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 78, top: 41 + i * 32, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{kind}</span>
          {/* the masked value */}
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ right: 30, top: 41 + i * 32, letterSpacing: 2, ['--d' as string]: d, ['--t' as string]: '6s' }}>••••••••</span>
        </span>
      ))}
      {/* the one that reveals */}
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-in" style={{ right: 30, top: 41, ['--d' as string]: '3s', ['--t' as string]: '6s' }}>tr7-Kq2-9xF</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Vault lives on your nodes, not a vendor's</span>
    </div>
  );
}
