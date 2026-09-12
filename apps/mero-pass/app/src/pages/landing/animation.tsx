/**
 * Mero Pass — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Eight secrets and an audit strip, not four rows. Four filled the top half
 * and left the rest blank, which at `/preview` size is most of the frame — and
 * a vault with four things in it is not the picture a team secret manager wants
 * to present. The audit strip is here for the same reason: the app records what
 * happened in the vault, and that is worth showing rather than describing.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/** [name, kind, when it animates] — the five types the app actually stores. */
const SECRETS: [string, string, string][] = [
  ['GitHub', 'login', '0.4s'],
  ['Deploy key', 'ssh', '0.8s'],
  ['Stripe', 'totp', '1.2s'],
  ['Wifi', 'note', '1.6s'],
  ['AWS root', 'login', '2.0s'],
  ['Grafana', 'totp', '2.4s'],
  ['Signing key', 'ssh', '2.8s'],
  ['Recovery codes', 'note', '3.2s'],
];

const ROW_H = 28;
const TOP = 32;

export default function PassAnimation() {
  const bottom = TOP + SECRETS.length * ROW_H;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Team vault</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>3 members</span>

      {SECRETS.map(([name, kind, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: TOP + i * ROW_H, right: 20, height: ROW_H - 5, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 30, top: TOP + 8 + i * ROW_H, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 130, top: TOP + 9 + i * ROW_H, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{kind}</span>
          {/* The masked value. Row 0 unmasks below, so it steps out of the way
              for exactly that window rather than being written over. */}
          <span
            className={`cal-lp-a-txt cal-lp-a-txt--dim ${i === 0 ? 'cal-lp-a-hide' : 'cal-lp-a-rise'}`}
            style={{ right: 30, top: TOP + 8 + i * ROW_H, letterSpacing: 2, ['--d' as string]: i === 0 ? '3.6s' : d, ['--t' as string]: '6s' }}
          >
            ••••••••
          </span>
        </span>
      ))}

      {/* The one that reveals, in the same slot the dots vacate. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--accent cal-lp-a-peek" style={{ right: 30, top: TOP + 8, ['--d' as string]: '3.6s', ['--t' as string]: '6s' }}>
        tr7-Kq2-9xF
      </span>

      {/* The audit log: the vault records what happened, and it replicates too. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: bottom + 10 }}>Recent</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: bottom + 28, fontSize: 8.5 }}>Ana revealed GitHub · 2m ago</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: bottom + 42, fontSize: 8.5 }}>Marko added Recovery codes · 1h ago</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 4, fontSize: 8.5 }}>Vault lives on your nodes, not a vendor&apos;s</span>
    </div>
  );
}
