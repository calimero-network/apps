/**
 * Mero Stream — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

/** Frames leaving an encoder for a decoder, with the throughput it measures. */
export default function StreamAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Encode · node A</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ right: 20, top: 10 }}>Decode · node B</span>
      <span className="cal-lp-a-pane" style={{ left: 18, top: 28, width: 68, height: 50 }} />
      <span className="cal-lp-a-pane" style={{ right: 18, top: 28, width: 68, height: 50 }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 26, top: 50, fontSize: 8.5 }}>H.264 · 720p</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 26, top: 50, fontSize: 8.5 }}>12 fragments</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="cal-lp-a-box cal-lp-a-drift"
          style={{
            left: 92, top: 40 + (i % 3) * 10, width: 13, height: 6, borderRadius: 2,
            background: 'var(--cal-lp-accent)', borderColor: 'transparent',
            ['--dx' as string]: '62px', ['--dy' as string]: '0px',
            ['--d' as string]: `${i * 0.45}s`, ['--t' as string]: '2.8s',
          }}
        />
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 96 }}>Throughput</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 96 }}>1.9 MB/s</span>
      <span className="cal-lp-a-pane" style={{ left: 20, top: 114, right: 20, height: 9 }} />
      <span className="cal-lp-a-box cal-lp-a-grow" style={{ left: 20, top: 114, width: 152, height: 9, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '0.5s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>A capacity probe — measured, not promised</span>
    </div>
  );
}
