/**
 * Mero PixArt — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame, and laid out like the editor: a tool rail, a canvas,
 * and a layer panel. The previous version drew a 126px canvas column and a
 * three-row layer list, which left the middle of the frame empty — the exact
 * middle where the artwork belongs.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/** [name, kind, delay] — the real layer types: raster, text, fill, adjustment. */
const LAYERS: [string, string, string][] = [
  ['Curves', 'adjustment', '0.4s'],
  ['Headline', 'text', '0.8s'],
  ['Sky', 'raster', '1.2s'],
  ['Figure', 'raster · masked', '1.6s'],
  ['Grain', 'adjustment', '2.0s'],
  ['Backdrop', 'fill', '2.4s'],
];

const RAIL_X = 20;
const CANVAS_X = 54;
const CANVAS_W = 268;
const PANEL_X = 336;

export default function PixArtAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>poster.png · 1200 × 1600</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>2 editing</span>

      {/* The tool rail. */}
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <span
          key={`tool${i}`}
          className="cal-lp-a-box"
          style={{
            left: RAIL_X,
            top: 30 + i * 26,
            width: 22,
            height: 22,
            borderRadius: 4,
            ...(i === 1 ? { background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent' } : {}),
          }}
        />
      ))}

      {/* The canvas, and what is painted on it. */}
      <span className="cal-lp-a-pane" style={{ left: CANVAS_X, top: 30, width: CANVAS_W, bottom: 22, background: 'var(--cal-lp-bg-1)' }} />
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: CANVAS_X + 16, top: 46, width: CANVAS_W - 32, height: 96, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.5s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-dot cal-lp-a-in" style={{ left: CANVAS_X + 168, top: 104, width: 72, height: 72, background: 'var(--cal-lp-border-strong)', ['--d' as string]: '1.1s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-in" style={{ left: CANVAS_X + 26, top: 70, fontSize: 15, ['--d' as string]: '1.6s', ['--t' as string]: '6s' }}>
        Headline
      </span>
      {/* A brush stroke, landing dab by dab. */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <span
          key={`dab${i}`}
          className="cal-lp-a-dot cal-lp-a-in"
          style={{
            left: CANVAS_X + 28 + i * 22,
            top: 214 + (i % 3) * 12,
            width: 14,
            height: 14,
            ['--d' as string]: `${2.2 + i * 0.12}s`,
            ['--t' as string]: '6s',
          }}
        />
      ))}
      <span className="cal-lp-a-cursor cal-lp-a-drift" style={{ left: CANVAS_X + 40, top: 224, ['--dx' as string]: '186px', ['--dy' as string]: '26px', ['--t' as string]: '6s' }} />

      {/* The layer panel. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: PANEL_X, top: 30 }}>Layers</span>
      {LAYERS.map(([name, kind, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: PANEL_X, top: 46 + i * 38, right: 20, height: 32, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: PANEL_X + 10, top: 53 + i * 38, fontSize: 9.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: PANEL_X + 10, top: 65 + i * 38, fontSize: 8, ['--d' as string]: d, ['--t' as string]: '6s' }}>{kind}</span>
        </span>
      ))}
      {/* One layer's visibility toggles — non-destructively. */}
      <span className="cal-lp-a-box cal-lp-a-flash" style={{ left: PANEL_X, top: 46, right: 20, height: 32, background: 'transparent', ['--d' as string]: '3.4s', ['--t' as string]: '6s' }} />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Non-destructive · every layer a separate record · pixels on your node
      </span>
    </div>
  );
}
