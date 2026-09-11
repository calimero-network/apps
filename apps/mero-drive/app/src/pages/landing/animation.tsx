/**
 * Mero Drive Docs — a minimal mock of the app itself.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 * Shows REAL labels, the way the bespoke previews this replaced did.
 *
 * ⚠️ Sized to the frame, and redrawn around the thing that makes this app what
 * it is. Three documents and an upload bar filled 47% of the height — a
 * measured figure — and showed a flat list, which is precisely the wrong
 * picture: a folder here is its OWN CONTEXT, so the tree on the left is the
 * product and the documents on the right are one folder's worth.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/** [label, depth, selected] — the folder tree, each folder its own context. */
const TREE: [string, number, boolean][] = [
  ['Workspace', 0, false],
  ['Product', 1, false],
  ['specs', 2, true],
  ['research', 2, false],
  ['Design', 1, false],
  ['Legal', 1, false],
  ['Archive', 1, false],
];

const DOCS: [string, string, string][] = [
  ['Q3 roadmap.md', 'edited 2m ago · Ana', '0.5s'],
  ['Security review', 'edited 1h ago · Marko', '1.0s'],
  ['Launch checklist', 'edited yesterday · Iva', '1.5s'],
  ['Pricing notes', 'edited yesterday · Ana', '2.0s'],
  ['Migration plan', 'edited 3d ago · Marko', '2.5s'],
];

const PANE_X = 168;

export default function DriveAnimation() {
  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* The tree. Each row is a folder, and each folder is a separate context
          — which is how sharing one does not share the others. */}
      <span className="cal-lp-a-pane" style={{ left: 20, top: 30, width: 128, bottom: 20 }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: 20, top: 12 }}>Folders</span>
      {TREE.map(([label, depth, selected], i) => (
        <span key={label}>
          {selected && (
            <span
              className="cal-lp-a-box"
              style={{ left: 26, top: 38 + i * 26, width: 116, height: 22, borderRadius: 4, background: 'var(--cal-lp-accent-soft)', borderColor: 'transparent' }}
            />
          )}
          <span
            className={`cal-lp-a-txt ${selected ? 'cal-lp-a-txt--val' : 'cal-lp-a-txt--dim'}`}
            style={{ left: 34 + depth * 12, top: 45 + i * 26, fontSize: 9.5 }}
          >
            {label}
          </span>
        </span>
      ))}

      {/* One folder's documents. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: PANE_X, top: 12 }}>Product / specs</span>
      <span className="cal-lp-a-txt cal-lp-a-txt--accent" style={{ right: 20, top: 12 }}>Shared with 3</span>
      {DOCS.map(([name, meta, d], i) => (
        <span key={name}>
          <span className="cal-lp-a-box cal-lp-a-rise" style={{ left: PANE_X, top: 30 + i * 40, right: 20, height: 34, ['--d' as string]: d, ['--t' as string]: '6s' }} />
          <span className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-rise" style={{ left: PANE_X + 10, top: 38 + i * 40, ['--d' as string]: d, ['--t' as string]: '6s' }}>{name}</span>
          <span className="cal-lp-a-txt cal-lp-a-txt--dim cal-lp-a-rise" style={{ left: PANE_X + 10, top: 51 + i * 40, fontSize: 8.5, ['--d' as string]: d, ['--t' as string]: '6s' }}>{meta}</span>
        </span>
      ))}

      {/* The upload, last. */}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: PANE_X, top: 240, fontSize: 8.5 }}>Uploading design-system.pdf</span>
      <span className="cal-lp-a-pane" style={{ left: PANE_X, top: 254, right: 20, height: 6 }} />
      <span
        className="cal-lp-a-box cal-lp-a-grow"
        style={{ left: PANE_X, top: 254, right: 20, height: 6, background: 'var(--cal-lp-accent)', borderColor: 'transparent', transformOrigin: 'left', ['--d' as string]: '3.0s', ['--t' as string]: '6s' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: PANE_X, top: 276, fontSize: 8.5 }}>
        This folder replicates to its three members — and to nobody else
      </span>
    </div>
  );
}
