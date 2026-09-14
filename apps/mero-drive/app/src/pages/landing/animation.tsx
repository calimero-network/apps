/**
 * Mero Drive — the hero animation: the app's own workspace.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ WHAT WAS WRONG BEFORE
 * A folder tree on the left and a LIST OF DOCUMENT CARDS on the right. Mero
 * Drive has no such list: documents are leaves INSIDE the tree
 * (`FolderDocLeaves`), and the main pane is the editor itself. The old picture
 * also gave a third of its height to an upload progress bar for a file, which
 * is a different product — this one is documents.
 *
 * WHAT IT MIRRORS NOW, piece by piece:
 *   • `workspace/WorkspaceLayout.tsx` — the three-pane shell: a top bar with
 *     the mark, the namespace switcher and the node dot; a left rail; the
 *     editor filling the rest.
 *   • `folders/FolderTreeItem.tsx` — chevron, folder icon, the alias, and a
 *     LOCK on a restricted folder. The selected row is tinted.
 *   • `folders/FolderDocLeaves.tsx` — documents nested under their expanded
 *     folder with a file icon, indented past the chevron column.
 *   • `editor/EditorHeader.tsx` — "‹ Documents", then the file icon and the
 *     document's title, centred.
 *   • `editor/EditorStatusBar.tsx` — the save state, the word count and the
 *     character count, in that order.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── Layout: the same three panes as WorkspaceLayout ─────────────────── */
const BAR_TOP = 6;
const BAR_H = 24;
const BODY_TOP = BAR_TOP + BAR_H + 6;
const BODY_BOTTOM = 302;
const RAIL_X = 20;
const RAIL_W = 132;
const MAIN_X = RAIL_X + RAIL_W + 8;
const MAIN_R = 20;
const STATUS_H = 20;

/* ── The lucide icons the app uses, at 12px ──────────────────────────── */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...stroke}>
    {open ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 18 15 12 9 6" />}
  </svg>
);
const FolderIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...stroke}>
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
  </svg>
);
const FileIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...stroke}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...stroke}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/* ── The tree. `kind` decides the icon; `lock` is a restricted folder. ── */
interface Row {
  label: string;
  depth: number;
  kind: 'folder' | 'doc';
  open?: boolean;
  lock?: boolean;
  selected?: boolean;
}
const TREE: Row[] = [
  { label: 'Product team', depth: 0, kind: 'folder', open: true },
  { label: 'Product', depth: 1, kind: 'folder', open: true },
  { label: 'specs', depth: 2, kind: 'folder', open: true, lock: true },
  { label: 'Q3 roadmap', depth: 3, kind: 'doc', selected: true },
  { label: 'Auth rollout', depth: 3, kind: 'doc' },
  { label: 'research', depth: 2, kind: 'folder' },
  { label: 'Design', depth: 1, kind: 'folder', lock: true },
  { label: 'Legal', depth: 1, kind: 'folder', lock: true },
];
const ROW_H = 21;

/* ── The document, as BlockNote would lay it out ─────────────────────── */
interface Block {
  /** Fraction of the column width this line runs to. */
  w: number;
  /** A heading, a paragraph line, or a bullet. */
  kind: 'h' | 'p' | 'li';
  d: string;
}
const BLOCKS: Block[] = [
  { w: 0.94, kind: 'p', d: '0.4s' },
  { w: 0.88, kind: 'p', d: '0.5s' },
  { w: 0.42, kind: 'p', d: '0.6s' },
  { w: 0.36, kind: 'h', d: '1.0s' },
  { w: 0.8, kind: 'li', d: '1.3s' },
  { w: 0.7, kind: 'li', d: '1.5s' },
  { w: 0.86, kind: 'li', d: '1.7s' },
  { w: 0.92, kind: 'p', d: '2.2s' },
  { w: 0.58, kind: 'p', d: '2.4s' },
];

const ROW = { display: 'flex', alignItems: 'center' } as const;
const TXT = { fontFamily: 'var(--cal-lp-font)', lineHeight: 1 } as const;

export default function DriveAnimation() {
  const mainW = 495 - MAIN_R - MAIN_X;
  const docX = MAIN_X + 26;
  const docW = mainW - 52;
  const headerH = 22;
  const bodyTop = BODY_TOP + headerH + 10;

  let y = bodyTop + 30;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-box"
        style={{ left: 20, top: BAR_TOP, right: 20, height: BAR_H, borderRadius: 6, background: 'var(--cal-lp-bg-3)' }}
      />
      <span
        className="cal-lp-a-box"
        style={{ left: 27, top: BAR_TOP + 5, width: 14, height: 14, borderRadius: 4, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 46, top: BAR_TOP + 9, fontSize: 9 }}>
        Mero Drive
      </span>
      {/* The namespace switcher: one workspace, and it is a Calimero context. */}
      <span className="cal-lp-a-chip" style={{ left: 108, top: BAR_TOP + 5, fontSize: 8, padding: '2px 8px' }}>
        Product team ▾
      </span>
      {/* `right` positions the RIGHT edge, so this has to clear the whole
          width of the node URL beside it, not just its start. */}
      <span
        className="cal-lp-a-dot"
        style={{ right: 134, top: BAR_TOP + 10, width: 5, height: 5, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 66, top: BAR_TOP + 9, fontSize: 8 }}>
        localhost:2428
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 26, top: BAR_TOP + 9, fontSize: 8 }}>
        Settings
      </span>

      {/* ── Left rail: the folder tree ──────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{ left: RAIL_X, top: BODY_TOP, width: RAIL_W, height: BODY_BOTTOM - BODY_TOP, borderRadius: 6 }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: RAIL_X + 10, top: BODY_TOP + 10, fontSize: 7.5 }}>
        Folders
      </span>
      {TREE.map((row, i) => {
        const top = BODY_TOP + 26 + i * ROW_H;
        const indent = RAIL_X + 6 + row.depth * 9;
        return (
          <span key={row.label}>
            {row.selected && (
              <span
                className="cal-lp-a-box"
                style={{
                  left: RAIL_X + 5,
                  top,
                  width: RAIL_W - 10,
                  height: ROW_H - 3,
                  borderRadius: 4,
                  background: 'var(--cal-lp-accent-soft)',
                  borderColor: 'transparent',
                }}
              />
            )}
            <span
              style={{
                ...ROW,
                ...TXT,
                position: 'absolute',
                left: indent,
                top: top + 5,
                gap: 4,
                fontSize: 8.5,
                fontWeight: row.selected ? 650 : 400,
                color: row.selected
                  ? 'var(--cal-lp-accent-ink)'
                  : row.kind === 'doc'
                    ? 'var(--cal-lp-text-dim)'
                    : 'var(--cal-lp-text)',
              }}
            >
              {/* Docs get a blank chevron column, the way the leaves align in
                  the app: the file icon sits under its siblings' folder icons. */}
              <span style={{ width: 8, display: 'inline-flex', color: 'var(--cal-lp-text-faint)' }}>
                {row.kind === 'folder' && <Chevron open={!!row.open} />}
              </span>
              <span style={{ display: 'inline-flex', color: 'inherit', opacity: row.selected ? 1 : 0.75 }}>
                {row.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
              </span>
              {row.label}
              {row.lock && (
                <span style={{ display: 'inline-flex', color: 'var(--cal-lp-text-faint)' }}>
                  <LockIcon />
                </span>
              )}
            </span>
          </span>
        );
      })}

      {/* ── Main pane: the editor ───────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: MAIN_X,
          top: BODY_TOP,
          right: MAIN_R,
          height: BODY_BOTTOM - BODY_TOP,
          borderRadius: 6,
          background: 'var(--cal-lp-bg-1)',
        }}
      />
      {/* EditorHeader: back on the left, the title centred, a menu on the right */}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: MAIN_X + 10, top: BODY_TOP + 8, fontSize: 8 }}>
        ‹ Documents
      </span>
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: MAIN_X,
          top: BODY_TOP + 7,
          width: mainW,
          gap: 4,
          justifyContent: 'center',
          fontSize: 8.5,
          fontWeight: 600,
          color: 'var(--cal-lp-text)',
        }}
      >
        <span style={{ display: 'inline-flex', color: 'var(--cal-lp-text-faint)' }}>
          <FileIcon />
        </span>
        Q3 roadmap
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: MAIN_R + 10, top: BODY_TOP + 7, fontSize: 10 }}>
        ⋯
      </span>
      <span
        className="cal-lp-a-line"
        style={{ left: MAIN_X, top: BODY_TOP + headerH, width: mainW, height: 1 }}
      />

      {/* The document itself. */}
      <span
        className="cal-lp-a-txt cal-lp-a-txt--val"
        style={{ left: docX, top: bodyTop, fontSize: 15, fontWeight: 700 }}
      >
        Q3 roadmap
      </span>
      {BLOCKS.map((b, i) => {
        const isH = b.kind === 'h';
        const top = y;
        y += isH ? 26 : 17;
        return (
          <span key={i}>
            {b.kind === 'li' && (
              <span
                className="cal-lp-a-dot"
                style={{ left: docX, top: top + 2, width: 3, height: 3, background: 'var(--cal-lp-text-faint)' }}
              />
            )}
            <span
              className="cal-lp-a-line cal-lp-a-grow"
              style={{
                left: b.kind === 'li' ? docX + 9 : docX,
                top,
                width: (b.kind === 'li' ? docW - 9 : docW) * b.w,
                height: isH ? 9 : 6,
                borderRadius: isH ? 3 : 3,
                background: isH ? 'var(--cal-lp-border-strong)' : 'var(--cal-lp-border)',
                transformOrigin: 'left',
                ['--d' as string]: b.d,
                ['--t' as string]: '6s',
              }}
            />
          </span>
        );
      })}

      {/* Somebody else's caret, mid-paragraph — the collab editor's presence. */}
      <span
        className="cal-lp-a-box cal-lp-a-blink"
        style={{
          left: docX + docW * 0.58 + 4,
          top: y - 14,
          width: 1.5,
          height: 10,
          borderRadius: 0,
          background: 'var(--cal-lp-accent)',
          borderColor: 'transparent',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-chip cal-lp-a-blink"
        style={{
          left: docX + docW * 0.58 + 6,
          top: y - 24,
          padding: '2px 5px',
          fontSize: 7,
          background: 'var(--cal-lp-accent)',
          color: 'var(--cal-lp-accent-text)',
          ['--t' as string]: '6s',
        }}
      >
        Ana
      </span>

      {/* EditorStatusBar: save state, then the two counts. */}
      <span
        className="cal-lp-a-line"
        style={{ left: MAIN_X, top: BODY_BOTTOM - STATUS_H, width: mainW, height: 1 }}
      />
      <span
        className="cal-lp-a-dot"
        style={{ left: MAIN_X + 10, top: BODY_BOTTOM - STATUS_H + 8, width: 5, height: 5, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: MAIN_X + 20, top: BODY_BOTTOM - STATUS_H + 7, fontSize: 8 }}>
        Saved
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: MAIN_R + 10, top: BODY_BOTTOM - STATUS_H + 7, fontSize: 8 }}>
        412 words · 2,318 characters
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Each folder is its own context — a lock means it replicates to its members and nobody else
      </span>
    </div>
  );
}
