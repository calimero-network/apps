/**
 * Mero Stream — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame, and showing the measurement rather than a pipe. This
 * app IS its numbers — it exists to find the capacity ceiling and report it —
 * so the frame now carries the frame ledger and the delivery figure, not just
 * two boxes and an arrow occupying the top third.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

const PANEL_W = 150;
const PANEL_H = 96;

export default function StreamAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Encode · node A</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ right: 20, top: 10 }}>Decode · node B</span>

      <span className="cal-lp-a-pane" style={{ left: 20, top: 30, width: PANEL_W, height: PANEL_H }} />
      <span className="cal-lp-a-pane" style={{ right: 20, top: 30, width: PANEL_W, height: PANEL_H }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 32, top: 46, fontSize: 9.5 }}>H.264 · 720p</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 32, top: 62, fontSize: 8.5 }}>WebCodecs path</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 32, top: 76, fontSize: 8.5 }}>seq 1184 · 30 fps</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ right: 32, top: 46, fontSize: 9.5 }}>12 fragments</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 32, top: 62, fontSize: 8.5 }}>keyframe @ 1176</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 32, top: 76, fontSize: 8.5 }}>2 dropped</span>

      {/* Frames crossing the gap between the two panels. */}
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="cal-lp-a-box cal-lp-a-drift"
          style={{
            left: 178,
            top: 44 + (i % 4) * 16,
            width: 16,
            height: 7,
            borderRadius: 2,
            background: 'var(--cal-lp-accent)',
            borderColor: 'transparent',
            ['--dx' as string]: '128px',
            ['--dy' as string]: '0px',
            ['--d' as string]: `${i * 0.38}s`,
            ['--t' as string]: '2.8s',
          }}
        />
      ))}

      {/* The ledger: a monotone sequence, and tombstones that are never reused. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 146 }}>Fragment ledger</span>
      {[
        ['1180', 'delivered'],
        ['1181', 'delivered'],
        ['1182', 'tombstoned'],
        ['1183', 'delivered'],
        ['1184', 'in flight'],
      ].map(([seq, state], i) => (
        <span key={seq}>
          <span className="cal-lp-a-box" style={{ left: 20, top: 164 + i * 22, right: 20, height: 18, borderRadius: 3 }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 30, top: 169 + i * 22, fontSize: 9 }}>#{seq}</span>
          <span
            className="cal-lp-a-txt"
            style={{
              right: 30,
              top: 169 + i * 22,
              fontSize: 8.5,
              color: state === 'delivered' ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text-faint)',
            }}
          >
            {state}
          </span>
        </span>
      ))}

      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 286 }}>Throughput</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 286 }}>1.9 MB/s · 96% delivered</span>
      <span className="cal-lp-a-pane" style={{ left: 20, top: 302, right: 20, height: 9 }} />
      <span
        className="cal-lp-a-box cal-lp-a-grow"
        style={{ left: 20, top: 302, width: 436, height: 9, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '0.5s', ['--t' as string]: '6s' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        A capacity probe — measured, not promised
      </span>
    </div>
  );
}
