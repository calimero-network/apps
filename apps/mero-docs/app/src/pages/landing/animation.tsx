/**
 * Mero Docs - the hero animation: the app's own workspace.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ DRAWN FROM THE RUNNING APP. The workspace shell was booted with auth
 * injected and the node mocked, and screenshotted. Its own e2e suites are
 * `single-node` / `two-node` and need real merod, so the tree and the editor
 * are reconstructed from their components — but the CHROME below is traced off
 * the real thing, and it corrected three guesses:
 *   • the shell is full-bleed. One bar across the top with a hairline under it
 *     and a hairline between rail and main — not floating rounded cards.
 *   • the top bar carries a sidebar toggle, the mark, the name, then a
 *     workspace SELECT with New workspace / Join workspace beside it, and on
 *     the right the node dot, the node URL, a theme toggle and Log out.
 *   • the rail has its own header row — FOLDERS, a New button, a bottom rule —
 *     above the tree.
 *
 * The rest is component by component:
 *   • `folders/FolderTree.tsx` — the header row and the `<ul>` of rows.
 *   • `folders/FolderTreeItem.tsx` — chevron, folder icon, alias, and a LOCK
 *     on a restricted folder. The selected row is tinted.
 *   • `folders/FolderDocLeaves.tsx` — documents nested under their expanded
 *     folder with a file icon, indented past the chevron column.
 *   • `editor/EditorHeader.tsx` — "‹ Documents", the file icon and title
 *     centred, a menu on the right.
 *   • `editor/EditorStatusBar.tsx` — save state, word count, character count.
 *
 * ⚠️ COLOUR stays the page's. The app is dark by default with a teal primary;
 * this page is light by default and themes on a toggle, so a hero that used
 * the app's palette would be wrong in one theme or the other.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── Layout: the three-pane shell, full-bleed like the app ───────────── */
const L = 20;
const R = 475;
const BAR_TOP = 8;
const BAR_H = 26;
const BODY_TOP = BAR_TOP + BAR_H;
const BODY_BOTTOM = 306;
const RAIL_W = 136;
const MAIN_X = L + RAIL_W + 1;
const RAIL_HEAD = 18;
const HEADER_H = 24;
const STATUS_H = 21;

const TXT = { fontFamily: 'var(--cal-lp-font)', lineHeight: 1 } as const;
const ROW = { display: 'flex', alignItems: 'center' } as const;

/* ── The lucide icons the app uses ───────────────────────────────────── */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const PanelLeft = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);
const Sun = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const LogOut = () => (
  <svg viewBox="0 0 24 24" width="9" height="9" {...S}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);
const Plus = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const Chevron = ({ open }: { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    {open ? <polyline points="6 9 12 15 18 9" /> : <polyline points="9 18 15 12 9 6" />}
  </svg>
);
const FolderIcon = () => (
  <svg viewBox="0 0 24 24" width="10" height="10" {...S}>
    <path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2Z" />
  </svg>
);
const FileIcon = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} {...S}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="13" y2="17" />
  </svg>
);
const LockIcon = () => (
  <svg viewBox="0 0 24 24" width="8" height="8" {...S}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/* ── The tree ────────────────────────────────────────────────────────── */
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

/* ── The document, as BlockNote lays it out ──────────────────────────── */
const BLOCKS: { w: number; kind: 'h' | 'p' | 'li'; d: string }[] = [
  { w: 0.95, kind: 'p', d: '0.4s' },
  { w: 0.88, kind: 'p', d: '0.5s' },
  { w: 0.44, kind: 'p', d: '0.6s' },
  { w: 0.34, kind: 'h', d: '1.0s' },
  { w: 0.82, kind: 'li', d: '1.3s' },
  { w: 0.7, kind: 'li', d: '1.5s' },
  { w: 0.88, kind: 'li', d: '1.7s' },
  { w: 0.93, kind: 'p', d: '2.2s' },
  { w: 0.6, kind: 'p', d: '2.4s' },
];

/** A bordered control in the top bar, the app's `Button variant="outline"`. */
function BarButton({
  left,
  width,
  children,
}: {
  left: number;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <span
      className="cal-lp-a-box"
      style={{
        left,
        top: BAR_TOP + 5,
        width,
        height: 16,
        borderRadius: 4,
        background: 'var(--cal-lp-bg-1)',
        ...ROW,
        justifyContent: 'center',
        gap: 3,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export default function DriveAnimation() {
  const mainW = R - MAIN_X;
  const docX = MAIN_X + 26;
  const docW = mainW - 52;
  const bodyTop = BODY_TOP + HEADER_H + 12;
  let y = bodyTop + 30;

  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* ── Top bar ─────────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{ left: L, top: BAR_TOP, width: R - L, height: BAR_H, border: 'none', borderRadius: 0 }}
      />
      <span className="cal-lp-a-line" style={{ left: L, top: BAR_TOP + BAR_H, width: R - L, height: 1 }} />

      <span style={{ position: 'absolute', left: L + 7, top: BAR_TOP + 8, color: 'var(--cal-lp-text-faint)' }}>
        <PanelLeft />
      </span>
      <span
        className="cal-lp-a-box"
        style={{ left: L + 23, top: BAR_TOP + 8, width: 11, height: 11, borderRadius: 3, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: L + 39, top: BAR_TOP + 10, fontSize: 8.5, fontWeight: 700 }}>
        Mero Docs
      </span>
      <span className="cal-lp-a-line" style={{ left: L + 92, top: BAR_TOP + 6, width: 1, height: 14 }} />

      {/* The namespace switcher is a <select>: one workspace, one context. */}
      <BarButton left={L + 100} width={74}>
        <span style={{ ...TXT, fontSize: 7.5, color: 'var(--cal-lp-text)' }}>Product team</span>
        <span style={{ ...TXT, fontSize: 7, color: 'var(--cal-lp-text-faint)' }}>▾</span>
      </BarButton>
      {/* ⚠️ The app says "New workspace" / "Join workspace" and these keep its
          words, so they need the room its 1440px bar has and this one does
          not. Measured at 7px: 62 and 60, ending 23px clear of the node dot.
          Undersized, the label does not shrink — it spills past the button. */}
      <BarButton left={L + 178} width={62}>
        <span style={{ ...TXT, fontSize: 7, color: 'var(--cal-lp-text-dim)' }}>New workspace</span>
      </BarButton>
      <BarButton left={L + 244} width={60}>
        <span style={{ ...TXT, fontSize: 7, color: 'var(--cal-lp-text-dim)' }}>Join workspace</span>
      </BarButton>

      <span
        className="cal-lp-a-dot"
        style={{ left: R - 128, top: BAR_TOP + 11, width: 5, height: 5, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: R - 119, top: BAR_TOP + 10, fontSize: 7.5 }}>
        localhost:2428
      </span>
      <span style={{ position: 'absolute', left: R - 56, top: BAR_TOP + 8, color: 'var(--cal-lp-text-faint)' }}>
        <Sun />
      </span>
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: R - 40,
          top: BAR_TOP + 9,
          gap: 3,
          fontSize: 7.5,
          color: 'var(--cal-lp-text-dim)',
        }}
      >
        <LogOut />
        Log out
      </span>

      {/* ── Left rail: the folder tree ──────────────────────────────── */}
      <span className="cal-lp-a-line" style={{ left: L + RAIL_W, top: BODY_TOP, width: 1, height: BODY_BOTTOM - BODY_TOP }} />
      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: L + 10, top: BODY_TOP + 6, fontSize: 7, letterSpacing: '0.07em' }}>
        Folders
      </span>
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: L + RAIL_W - 34,
          top: BODY_TOP + 5,
          gap: 2,
          fontSize: 7.5,
          color: 'var(--cal-lp-text-dim)',
        }}
      >
        <Plus />
        New
      </span>
      <span className="cal-lp-a-line" style={{ left: L, top: BODY_TOP + RAIL_HEAD, width: RAIL_W, height: 1 }} />

      {TREE.map((row, i) => {
        const top = BODY_TOP + RAIL_HEAD + 6 + i * ROW_H;
        return (
          <span key={row.label}>
            {row.selected && (
              <span
                className="cal-lp-a-box"
                style={{
                  left: L + 6,
                  top,
                  width: RAIL_W - 14,
                  height: ROW_H - 4,
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
                left: L + 8 + row.depth * 9,
                top: top + 4,
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
              {/* Docs get a blank chevron column, so their file icon lines up
                  under a sibling subfolder's folder icon. */}
              <span style={{ width: 8, display: 'inline-flex', color: 'var(--cal-lp-text-faint)' }}>
                {row.kind === 'folder' && <Chevron open={!!row.open} />}
              </span>
              <span style={{ display: 'inline-flex', opacity: row.selected ? 1 : 0.75 }}>
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
          width: mainW,
          height: BODY_BOTTOM - BODY_TOP,
          border: 'none',
          borderRadius: 0,
          background: 'var(--cal-lp-bg-1)',
        }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: MAIN_X + 10, top: BODY_TOP + 9, fontSize: 8 }}>
        ‹ Documents
      </span>
      <span
        style={{
          ...ROW,
          ...TXT,
          position: 'absolute',
          left: MAIN_X,
          top: BODY_TOP + 8,
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
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: R - 20, top: BODY_TOP + 7, fontSize: 10 }}>
        ⋯
      </span>
      <span className="cal-lp-a-line" style={{ left: MAIN_X, top: BODY_TOP + HEADER_H, width: mainW, height: 1 }} />

      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: docX, top: bodyTop, fontSize: 15, fontWeight: 700 }}>
        Q3 roadmap
      </span>
      {BLOCKS.map((b, i) => {
        const isH = b.kind === 'h';
        const top = y;
        y += isH ? 24 : 16;
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
                borderRadius: 3,
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
          left: docX + docW * 0.6 + 4,
          top: y - 16,
          width: 1.5,
          height: 11,
          borderRadius: 0,
          background: 'var(--cal-lp-accent)',
          borderColor: 'transparent',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-chip cal-lp-a-blink"
        style={{
          left: docX + docW * 0.6 + 6,
          top: y - 27,
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
      <span className="cal-lp-a-line" style={{ left: MAIN_X, top: BODY_BOTTOM - STATUS_H, width: mainW, height: 1 }} />
      <span
        className="cal-lp-a-dot"
        style={{ left: MAIN_X + 10, top: BODY_BOTTOM - STATUS_H + 8, width: 5, height: 5, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: MAIN_X + 20, top: BODY_BOTTOM - STATUS_H + 7, fontSize: 8 }}>
        Saved
      </span>
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ right: 26, top: BODY_BOTTOM - STATUS_H + 7, fontSize: 8 }}>
        412 words · 2,318 characters
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Each folder is its own context — a lock means it replicates to its members and nobody else
      </span>
    </div>
  );
}
