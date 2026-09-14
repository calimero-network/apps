/**
 * Mero Design — the hero animation: the app's own editor.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ WHAT WAS WRONG BEFORE
 * It showed a "Projects" list down the left, a properties column on the right,
 * and four lettered squares (V R O T) for a toolbar. Mero Design has no left
 * sidebar in its editor, its tool buttons are icons rather than letters, and
 * its panel is a THREE-TAB inspector — so the picture was of an app that does
 * not exist. The pieces below are all taken from the real thing:
 *
 *   • `components/Toolbar.tsx` — a 48px bar: mark, divider, then select / hand
 *     / rect / circle / line / arrow / pen / text, the active one tinted. The
 *     icons here are the same paths at a smaller size.
 *   • `components/PropertiesPanel.module.css` — the inspector on the RIGHT,
 *     opening on a tab bar (Props · Layers · Proto), then a kind badge, then
 *     uppercase group titles over a two-column field grid. The fields are the
 *     ones `PropertiesPanel.tsx` actually renders: X, Y, W, H, ∠, and ⌒, which
 *     only a rect has.
 *   • `components/CursorsOverlay.tsx` — other people's cursors, coloured by
 *     `colorForIdentity` out of the app's own eight-colour table.
 *   • `components/CommentsOverlay.tsx` — numbered pins on the canvas.
 *
 * ⚠️ COLOUR. The tool and element colours are literals from the app's CSS, but
 * every one of them is blended through a landing token (`tint()`), which is
 * what keeps this readable in dark mode — landing.css is themed, the app's
 * editor chrome is not.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── Layout ─────────────────────────────────────────────────────────────
   Toolbar across the top, inspector down the right, canvas taking the rest —
   the same three-part split as `pages/CanvasPage.tsx`. */
const BAR_H = 30;
const PANEL_W = 122;
const PANEL_X = 495 - 20 - PANEL_W;
const BODY_TOP = BAR_H + 12;
const BODY_BOTTOM = 320;

/** Blend an app literal into the page, so it themes instead of breaking. */
const tint = (hex: string, pct = 86) => `color-mix(in srgb, ${hex} ${pct}%, var(--cal-lp-bg-1))`;

/* The app's `CURSOR_COLORS`, in `colorForIdentity` order. */
const PEERS = [
  // Parked in the empty half of the artboard on purpose: a name chip that
  // drifts across the headline makes both unreadable, and `drift` moves these
  // a long way (to dx,dy and then to 1.6x dy).
  { name: 'Ana', color: '#3498db', x: 272, y: 168, dx: '24px', dy: '50px' },
  { name: 'Marko', color: '#e74c3c', x: 128, y: 284, dx: '30px', dy: '-12px' },
];

/* ── The toolbar's icons, at the app's own proportions ─────────────────── */
const ICONS: Record<string, React.ReactNode> = {
  select: <path d="M3.5 1.5v11l2.8-2.8 2 4 1.6-.8-2-4H11z" fill="currentColor" />,
  hand: (
    <path
      d="M6 7V3.5a1 1 0 0 1 2 0V7m0 0V3a1 1 0 0 1 2 0v4m0 0V4.5a1 1 0 0 1 2 0V9c0 2.5-1.5 5-4 5s-4-2-4-4V6a1 1 0 0 1 2 0v1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  ),
  rect: <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  circle: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  line: <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  arrow: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="13" x2="12" y2="4" />
      <polyline points="7,4 12,4 12,9" />
    </g>
  ),
  path: (
    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 2L14 4.5 5.5 13H3v-2.5z" />
      <line x1="9.5" y1="4" x2="12" y2="6.5" />
    </g>
  ),
  text: <path d="M3 3h10v2.5H9.5V13h-3V5.5H3z" fill="currentColor" />,
};
const TOOLS = ['select', 'hand', 'rect', 'circle', 'line', 'arrow', 'path', 'text'];
/** `rect` is held down, because a rectangle is what is being drawn below. */
const ACTIVE_TOOL = 'rect';

/** The inspector's Position & Size grid, exactly the fields the panel renders. */
const FIELDS: [string, string][] = [
  ['X', '120'],
  ['Y', '64'],
  ['W', '240'],
  ['H', '140'],
  ['∠', '0°'],
  ['⌒', '8'],
];

const MONO = { fontFamily: 'var(--cal-lp-font)', lineHeight: 1 } as const;

/** One uppercase group title, the panel's `.groupTitle`. */
function GroupTitle({ top, children }: { top: number; children: string }) {
  return (
    <span
      className="cal-lp-a-txt cal-lp-a-txt--head"
      style={{ left: PANEL_X + 9, top, fontSize: 7.5, letterSpacing: '0.06em' }}
    >
      {children}
    </span>
  );
}

export default function DesignAnimation() {
  const selection = { x: 116, y: 96, w: 104, h: 62 };
  const handles: [number, number][] = [
    [selection.x, selection.y],
    [selection.x + selection.w, selection.y],
    [selection.x, selection.y + selection.h],
    [selection.x + selection.w, selection.y + selection.h],
  ];

  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-box"
        style={{
          left: 20,
          top: 8,
          right: 20,
          height: BAR_H,
          borderRadius: 6,
          background: 'var(--cal-lp-bg-3)',
          borderColor: 'var(--cal-lp-border)',
        }}
      />
      <span
        className="cal-lp-a-box"
        style={{ left: 28, top: 15, width: 16, height: 16, borderRadius: 4, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: 50, top: 19, fontSize: 9 }}>
        Homepage
      </span>
      <span className="cal-lp-a-line" style={{ left: 106, top: 15, width: 1, height: 16, opacity: 0.8 }} />

      {TOOLS.map((t, i) => {
        const active = t === ACTIVE_TOOL;
        return (
          <span
            key={t}
            className="cal-lp-a-tool"
            style={{
              left: 116 + i * 20,
              top: 14,
              width: 18,
              height: 18,
              background: active ? 'var(--cal-lp-accent-soft)' : 'transparent',
              color: active ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text-faint)',
            }}
          >
            <svg viewBox="0 0 16 16" width="11" height="11">
              {ICONS[t]}
            </svg>
          </span>
        );
      })}

      {PEERS.map((p, i) => (
        <span
          key={p.name}
          className="cal-lp-a-av"
          style={{
            left: 421 + i * 14,
            top: 14,
            width: 18,
            height: 18,
            fontSize: 8,
            background: tint(p.color),
            color: '#fff',
            boxShadow: '0 0 0 1.5px var(--cal-lp-bg-3)',
          }}
        >
          {p.name[0]}
        </span>
      ))}
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 372, top: 19, fontSize: 8 }}>
        2 editing
      </span>

      {/* ── Canvas: the grey surround, then the artboard ─────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{ left: 20, top: BODY_TOP, width: PANEL_X - 30, height: BODY_BOTTOM - BODY_TOP, borderRadius: 6 }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 44, top: BODY_TOP + 8, fontSize: 7.5 }}>
        Artboard · 1440 × 900
      </span>
      <span
        className="cal-lp-a-box"
        style={{
          left: 40,
          top: BODY_TOP + 20,
          width: PANEL_X - 70,
          height: BODY_BOTTOM - BODY_TOP - 34,
          borderRadius: 4,
          background: 'var(--cal-lp-bg-1)',
          borderColor: 'var(--cal-lp-border)',
        }}
      />

      {/* Elements, in the kinds the app actually stores. */}
      <span
        className="cal-lp-a-box cal-lp-a-in"
        style={{
          left: selection.x,
          top: selection.y,
          width: selection.w,
          height: selection.h,
          borderRadius: 8,
          background: 'var(--cal-lp-accent-soft)',
          borderColor: 'var(--cal-lp-accent)',
          ['--d' as string]: '0.5s',
          ['--t' as string]: '6s',
        }}
      />
      {/* The four corner handles: what "selected" looks like in the editor. */}
      {handles.map(([hx, hy]) => (
        <span
          key={`${hx}-${hy}`}
          className="cal-lp-a-box"
          style={{
            left: hx - 3,
            top: hy - 3,
            width: 6,
            height: 6,
            borderRadius: 1,
            background: 'var(--cal-lp-bg-1)',
            borderColor: 'var(--cal-lp-accent)',
          }}
        />
      ))}
      <span
        className="cal-lp-a-dot cal-lp-a-in"
        style={{
          left: 238,
          top: 104,
          width: 44,
          height: 44,
          background: tint('#9b59b6'),
          ['--d' as string]: '1.4s',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-in"
        style={{ left: 116, top: 178, fontSize: 15, fontWeight: 700, ['--d' as string]: '2.2s', ['--t' as string]: '6s' }}
      >
        Ship it faster
      </span>
      <span
        className="cal-lp-a-line cal-lp-a-grow"
        style={{ left: 116, top: 202, width: 148, transformOrigin: 'left', ['--d' as string]: '2.6s', ['--t' as string]: '6s' }}
      />
      <span
        className="cal-lp-a-line cal-lp-a-grow"
        style={{ left: 116, top: 212, width: 104, transformOrigin: 'left', ['--d' as string]: '2.8s', ['--t' as string]: '6s' }}
      />
      <span
        className="cal-lp-a-box cal-lp-a-in"
        style={{
          left: 116,
          top: 230,
          width: 74,
          height: 22,
          borderRadius: 5,
          background: 'var(--cal-lp-accent)',
          borderColor: 'transparent',
          ['--d' as string]: '3.2s',
          ['--t' as string]: '6s',
        }}
      />

      {/* A comment pin, the way CommentsOverlay numbers them. */}
      <span
        className="cal-lp-a-av cal-lp-a-blink"
        style={{
          left: 258,
          top: 196,
          width: 16,
          height: 16,
          fontSize: 8,
          borderRadius: '50% 50% 50% 2px',
          background: tint('#f39c12'),
          color: '#fff',
          ['--t' as string]: '6s',
        }}
      >
        2
      </span>

      {/* Other people, cursor and name, coloured by identity. */}
      {PEERS.map((p) => (
        <span key={`c${p.name}`}>
          <span
            className="cal-lp-a-cursor cal-lp-a-drift"
            style={{
              left: p.x,
              top: p.y,
              background: tint(p.color),
              ['--dx' as string]: p.dx,
              ['--dy' as string]: p.dy,
              ['--t' as string]: '6s',
            }}
          />
          <span
            className="cal-lp-a-chip cal-lp-a-drift"
            style={{
              left: p.x + 9,
              top: p.y + 9,
              padding: '2px 5px',
              fontSize: 7.5,
              background: tint(p.color),
              color: '#fff',
              ['--dx' as string]: p.dx,
              ['--dy' as string]: p.dy,
              ['--t' as string]: '6s',
            }}
          >
            {p.name}
          </span>
        </span>
      ))}

      {/* ── Inspector ───────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{ left: PANEL_X, top: BODY_TOP, width: PANEL_W, height: BODY_BOTTOM - BODY_TOP, borderRadius: 6 }}
      />
      {['Props', 'Layers', 'Proto'].map((t, i) => (
        <span key={t}>
          <span
            className="cal-lp-a-txt cal-lp-a-txt--head"
            style={{
              left: PANEL_X + i * (PANEL_W / 3),
              top: BODY_TOP + 9,
              width: PANEL_W / 3,
              textAlign: 'center',
              fontSize: 7.5,
              color: i === 0 ? 'var(--cal-lp-accent-ink)' : undefined,
            }}
          >
            {t}
          </span>
          {i === 0 && (
            <span
              className="cal-lp-a-line"
              style={{
                left: PANEL_X + 8,
                top: BODY_TOP + 22,
                width: PANEL_W / 3 - 16,
                height: 2,
                background: 'var(--cal-lp-accent)',
              }}
            />
          )}
        </span>
      ))}
      <span className="cal-lp-a-line" style={{ left: PANEL_X, top: BODY_TOP + 23, width: PANEL_W, height: 1 }} />

      <span
        className="cal-lp-a-chip"
        style={{ left: PANEL_X + 9, top: BODY_TOP + 33, fontSize: 8, padding: '2px 7px' }}
      >
        rect
      </span>

      <GroupTitle top={BODY_TOP + 60}>Position &amp; size</GroupTitle>
      {FIELDS.map(([k, v], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        return (
          <span
            key={k}
            className="cal-lp-a-box"
            style={{
              left: PANEL_X + 9 + col * 53,
              top: BODY_TOP + 74 + row * 22,
              width: 48,
              height: 17,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '0 5px',
              background: 'var(--cal-lp-bg-1)',
            }}
          >
            <span style={{ ...MONO, fontSize: 7.5, fontWeight: 700, color: 'var(--cal-lp-text-faint)' }}>{k}</span>
            <span style={{ ...MONO, fontSize: 8, color: 'var(--cal-lp-text)' }}>{v}</span>
          </span>
        );
      })}

      <GroupTitle top={BODY_TOP + 152}>Fill</GroupTitle>
      <span
        className="cal-lp-a-box"
        style={{
          left: PANEL_X + 9,
          top: BODY_TOP + 166,
          width: 14,
          height: 14,
          borderRadius: 3,
          background: 'var(--cal-lp-accent)',
          borderColor: 'var(--cal-lp-border-strong)',
        }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: PANEL_X + 29, top: BODY_TOP + 170, fontSize: 8 }}>
        #A5FF11
      </span>

      <GroupTitle top={BODY_TOP + 194}>Opacity</GroupTitle>
      <span
        className="cal-lp-a-line"
        style={{ left: PANEL_X + 9, top: BODY_TOP + 212, width: PANEL_W - 42, height: 4, borderRadius: 2 }}
      />
      <span
        className="cal-lp-a-line"
        style={{ left: PANEL_X + 9, top: BODY_TOP + 212, width: PANEL_W - 42, height: 4, borderRadius: 2, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ right: 26, top: BODY_TOP + 209, fontSize: 8 }}>
        100%
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 2, fontSize: 8.5 }}>
        Every edit is a CRDT op — no design server, no file to merge
      </span>
    </div>
  );
}
