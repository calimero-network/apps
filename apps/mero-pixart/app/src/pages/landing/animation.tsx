/**
 * Mero PixArt — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const LAYERS: [string, string, string][] = [
  ['Curves', 'adjust', '0.4s'],
  ['Sky', 'raster', '1.0s'],
  ['Sketch', 'masked', '1.6s'],
];

/** A canvas with a named layer stack; a brush stroke lands and a layer toggles. */
export default function PixArtAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>poster.png</span>
      <span className="cal-lp-a-pane" style={{ left: 18, top: 28, width: 126, bottom: 18, background: 'var(--cal-lp-bg-1)' }} />
      <span className="cal-lp-a-box cal-lp-a-in" style={{ left: 30, top: 40, width: 100, height: 52, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent', ['--d' as string]: '0.5s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-dot cal-lp-a-in" style={{ left: 88, top: 76, width: 38, height: 38, background: 'var(--cal-lp-border-strong)', ['--d' as string]: '1.1s', ['--t' as string]: '6s' }} />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="cal-lp-a-dot cal-lp-a-in" style={{ left: 34 + i * 13, top: 122 + (i % 2) * 6, width: 10, height: 10, ['--d' as string]: `${2.2 + i * 0.14}s`, ['--t' as string]: '6s' }} />
      ))}

      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ right: 20, top: 28 }}>Layers</span>
      {LAYERS.map(([name, kind, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ right: 18, top: 46 + i * 32, width: 66, height: 26, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ right: 26, top: 52 + i * 32, fontSize: 9, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ right: 26, top: 62 + i * 32, fontSize: 8, ['--d' as string]: d, ['--t' as string]: '6s' }}>{kind}</span>
        </span>
      ))}
      <span className="cal-lp-a-box cal-lp-a-flash" style={{ right: 18, top: 46, width: 66, height: 26, background: 'transparent', ['--d' as string]: '3.2s', ['--t' as string]: '6s' }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>Non-destructive · pixels on your node</span>
    </div>
  );
}
