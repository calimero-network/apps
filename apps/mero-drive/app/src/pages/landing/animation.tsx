/**
 * Mero Drive Docs — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 */

const DOCS: [string, string, string][] = [
  ['Q3 roadmap.md', 'edited 2m ago', '0.4s'],
  ['Security review', 'edited 1h ago', '1.0s'],
  ['Launch checklist', 'edited yesterday', '1.6s'],
];

/** A folder of named documents; one uploads and seals. */
export default function DriveAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 10 }}>Product / specs</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 10 }}>Private folder</span>
      {DOCS.map(([name, meta, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: 20, top: 32 + i * 34, right: 20, height: 28, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: 30, top: 39 + i * 34, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: 30, top: 50 + i * 34, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{meta}</span>
        </span>
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, top: 142, fontSize: 8.5 }}>Uploading design-system.pdf</span>
      <span className="cal-lp-a-pane" style={{ left: 20, top: 154, right: 20, height: 6 }} />
      <span className="cal-lp-a-box cal-lp-a-grow" style={{ left: 20, top: 154, right: 20, height: 6, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '2.2s', ['--t' as string]: '6s' }} />
    </div>
  );
}
