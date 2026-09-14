/**
 * Mero Design — the hero animation: the app's own editor.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * ⚠️ DRAWN FROM THE RUNNING APP, not from reading its source. The editor was
 * booted against `e2e/canvas.spec.ts`'s mocks and screenshotted, which caught
 * four things no amount of reading the CSS had:
 *   • the canvas is an infinite DOTTED grid on white. There is no artboard, no
 *     grey surround, and no frame — an earlier version invented all three;
 *   • the chrome is full-bleed: one toolbar across the top with a hairline
 *     under it, and the inspector separated by a hairline, not floating cards;
 *   • the toolbar's right half is real — Options, a members and a comments
 *     button, Preview, Logout;
 *   • there is a zoom pill parked at the bottom centre of the canvas.
 *
 * Everything below is what the app actually shows, at this size:
 *   • `components/Toolbar.tsx` — back, mark, name, then select / hand / rect /
 *     circle / line / arrow / pen / text / image, the active one held down.
 *   • `components/PropertiesPanel.tsx` — PROPS · LAYERS · PROTO, the kind badge
 *     with Front/Back beside it, then NAME, POSITION & SIZE (X Y W H ∠ ⌒),
 *     APPEARANCE (a fill checkbox, swatch and hex; stroke; an opacity slider)
 *     and the PNG/SVG export pair.
 *   • `components/CursorsOverlay.tsx` / `CommentsOverlay.tsx` — other people's
 *     cursors, and numbered comment pins.
 *
 * ⚠️ COLOUR stays the page's, not the app's. The editor is a fixed light-grey
 * chrome with a blue accent; this page themes, and a hero that ignored that
 * would be unreadable in dark mode. App literals that carry identity are
 * blended through a landing token by `tint()` instead.
 *
 * Coordinates are literal pixels against a 495x341 box — see STAGE_DESIGN_W in
 * LandingPage.tsx.
 */

/* ── Layout: full-bleed chrome, the way the app is built ─────────────── */
const L = 20;
const R = 475;
const BAR_TOP = 8;
const BAR_H = 26;
const BODY_TOP = BAR_TOP + BAR_H;
const BODY_BOTTOM = 306;
const PANEL_W = 132;
const PANEL_X = R - PANEL_W;

/** Blend an app literal into the page, so it themes instead of breaking. */
const tint = (hex: string, pct = 82) => `color-mix(in srgb, ${hex} ${pct}%, var(--cal-lp-bg-1))`;

const TXT = { fontFamily: 'var(--cal-lp-font)', lineHeight: 1 } as const;
const ROW = { display: 'flex', alignItems: 'center' } as const;

/* ── Toolbar icons, the same paths the app draws at 16x16 ─────────────── */
const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const ICONS: Record<string, React.ReactNode> = {
  select: <path d="M3.5 1.5v11l2.8-2.8 2 4 1.6-.8-2-4H11z" fill="currentColor" />,
  hand: <path d="M6 7V3.5a1 1 0 0 1 2 0V7m0 0V3a1 1 0 0 1 2 0v4m0 0V4.5a1 1 0 0 1 2 0V9c0 2.5-1.5 5-4 5s-4-2-4-4V6a1 1 0 0 1 2 0v1" {...S} />,
  rect: <rect x="2" y="3" width="12" height="10" rx="1" {...S} />,
  circle: <circle cx="8" cy="8" r="5.5" {...S} />,
  line: <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  arrow: (
    <g {...S}>
      <line x1="3" y1="13" x2="12" y2="4" />
      <polyline points="7,4 12,4 12,9" />
    </g>
  ),
  path: (
    <g {...S}>
      <path d="M11.5 2L14 4.5 5.5 13H3v-2.5z" />
      <line x1="9.5" y1="4" x2="12" y2="6.5" />
    </g>
  ),
  text: <path d="M3 3h10v2.5H9.5V13h-3V5.5H3z" fill="currentColor" />,
  image: (
    <g {...S}>
      <rect x="1.5" y="3" width="13" height="10" rx="1" />
      <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
      <polyline points="1.5,11 5,7.5 7.5,10 10.5,7 14.5,11" />
    </g>
  ),
};
const TOOLS = ['select', 'hand', 'rect', 'circle', 'line', 'arrow', 'path', 'text', 'image'];
/** Held down, because a rectangle is what is being drawn on the canvas. */
const ACTIVE_TOOL = 'rect';

/* The app's own eight cursor colours, in `colorForIdentity` order. */
const PEERS = [
  { name: 'Ana', color: '#3498db', x: 250, y: 214, dx: '26px', dy: '40px' },
  { name: 'Marko', color: '#e74c3c', x: 116, y: 250, dx: '34px', dy: '-18px' },
];

/** The panel's `.grid2`, exactly the fields PropertiesPanel renders. */
const FIELDS: [string, string][] = [
  ['X', '260'],
  ['Y', '170'],
  ['W', '260'],
  ['H', '160'],
  ['∠', '0°'],
  ['⌒', '8'],
];

/** One uppercase `.groupTitle`. */
function Group({ top, children }: { top: number; children: string }) {
  return (
    <span
      className="cal-lp-a-txt cal-lp-a-txt--head"
      style={{ left: PANEL_X + 9, top, fontSize: 7, letterSpacing: '0.07em' }}
    >
      {children}
    </span>
  );
}

/** A bordered read-only field, the panel's `.textInput` / NumberField shape. */
function Field({
  left,
  top,
  width,
  label,
  value,
  swatch,
  center,
}: {
  left: number;
  top: number;
  width: number;
  label?: string;
  value: string;
  /** A colour chip inside the field, the way the Fill row carries one. */
  swatch?: boolean;
  center?: boolean;
}) {
  return (
    <span
      className="cal-lp-a-box"
      style={{
        left,
        top,
        width,
        height: 16,
        borderRadius: 3,
        background: 'var(--cal-lp-bg-1)',
        ...ROW,
        justifyContent: center ? 'center' : undefined,
        gap: 4,
        padding: '0 5px',
        // ⚠️ Both of these, or a value a hair too wide for its box WRAPS inside
        // it — which is what "↑ Front" did, turning a 16px field into two lines
        // of stacked glyphs.
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {label && (
        <span style={{ ...TXT, fontSize: 7, fontWeight: 700, color: 'var(--cal-lp-text-faint)' }}>{label}</span>
      )}
      {swatch && (
        <span
          style={{
            width: 8,
            height: 8,
            flex: 'none',
            borderRadius: 2,
            background: 'var(--cal-lp-accent)',
            border: '1px solid var(--cal-lp-border-strong)',
          }}
        />
      )}
      <span style={{ ...TXT, fontSize: 7.5, color: 'var(--cal-lp-text)' }}>{value}</span>
    </span>
  );
}

export default function DesignAnimation() {
  const sel = { x: 96, y: 108, w: 108, h: 66 };
  const handles: [number, number][] = [
    [sel.x, sel.y],
    [sel.x + sel.w, sel.y],
    [sel.x, sel.y + sel.h],
    [sel.x + sel.w, sel.y + sel.h],
  ];

  return (
    <div className="cal-lp-a" aria-hidden="true">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{ left: L, top: BAR_TOP, width: R - L, height: BAR_H, border: 'none', borderRadius: 0 }}
      />
      <span className="cal-lp-a-line" style={{ left: L, top: BAR_TOP + BAR_H, width: R - L, height: 1 }} />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: L + 7, top: BAR_TOP + 8, fontSize: 10 }}>
        ←
      </span>
      <span
        className="cal-lp-a-box"
        style={{ left: L + 22, top: BAR_TOP + 8, width: 11, height: 11, borderRadius: 3, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: L + 38, top: BAR_TOP + 10, fontSize: 8.5, fontWeight: 700 }}>
        Mero Design
      </span>
      <span className="cal-lp-a-line" style={{ left: L + 92, top: BAR_TOP + 6, width: 1, height: 14 }} />

      {TOOLS.map((t, i) => {
        const active = t === ACTIVE_TOOL;
        return (
          <span
            key={t}
            className="cal-lp-a-tool"
            style={{
              left: L + 100 + i * 18,
              top: BAR_TOP + 5,
              width: 16,
              height: 16,
              borderRadius: 4,
              background: active ? 'var(--cal-lp-accent-soft)' : 'transparent',
              color: active ? 'var(--cal-lp-accent-ink)' : 'var(--cal-lp-text-faint)',
            }}
          >
            <svg viewBox="0 0 16 16" width="10" height="10">
              {ICONS[t]}
            </svg>
          </span>
        );
      })}
      <span
        className="cal-lp-a-box"
        style={{
          left: L + 270,
          top: BAR_TOP + 5,
          width: 44,
          height: 16,
          borderRadius: 4,
          background: 'var(--cal-lp-bg-1)',
          ...ROW,
          justifyContent: 'center',
        }}
      >
        <span style={{ ...TXT, fontSize: 7.5, color: 'var(--cal-lp-text-dim)' }}>Options ▾</span>
      </span>

      {/* The right half of the bar: who is here, then Preview and Logout. */}
      {PEERS.map((p, i) => (
        <span
          key={p.name}
          className="cal-lp-a-av"
          style={{
            left: R - 116 + i * 11,
            top: BAR_TOP + 5,
            width: 16,
            height: 16,
            fontSize: 7.5,
            background: tint(p.color),
            color: '#fff',
            boxShadow: '0 0 0 1.5px var(--cal-lp-bg-3)',
          }}
        >
          {p.name[0]}
        </span>
      ))}
      <span
        className="cal-lp-a-box"
        style={{
          left: R - 84,
          top: BAR_TOP + 5,
          width: 38,
          height: 16,
          borderRadius: 4,
          background: 'transparent',
          borderColor: 'var(--cal-lp-accent)',
          ...ROW,
          justifyContent: 'center',
        }}
      >
        <span style={{ ...TXT, fontSize: 7.5, fontWeight: 650, color: 'var(--cal-lp-accent-ink)' }}>Preview</span>
      </span>
      <span
        className="cal-lp-a-box"
        style={{
          left: R - 42,
          top: BAR_TOP + 5,
          width: 34,
          height: 16,
          borderRadius: 4,
          background: 'var(--cal-lp-bg-1)',
          ...ROW,
          justifyContent: 'center',
        }}
      >
        <span style={{ ...TXT, fontSize: 7.5, color: 'var(--cal-lp-text-dim)' }}>Logout</span>
      </span>

      {/* ── Canvas: white, with the app's dotted grid. No artboard. ──── */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: L,
          top: BODY_TOP,
          width: PANEL_X - L,
          height: BODY_BOTTOM - BODY_TOP,
          border: 'none',
          borderRadius: 0,
          background: 'var(--cal-lp-bg-1)',
          backgroundImage: 'radial-gradient(var(--cal-lp-border-strong) 0.8px, transparent 0.8px)',
          backgroundSize: '11px 11px',
        }}
      />

      {/* Elements, in the kinds the app stores, on a fill like its default. */}
      <span
        className="cal-lp-a-box cal-lp-a-in"
        style={{
          left: sel.x,
          top: sel.y,
          width: sel.w,
          height: sel.h,
          borderRadius: 2,
          background: 'var(--cal-lp-accent)',
          borderColor: 'transparent',
          ['--d' as string]: '0.5s',
          ['--t' as string]: '6s',
        }}
      />
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
            borderColor: 'var(--cal-lp-accent-ink)',
          }}
        />
      ))}
      <span
        className="cal-lp-a-dot cal-lp-a-in"
        style={{
          left: 216,
          top: 104,
          width: 62,
          height: 62,
          background: tint('#4F8EF7'),
          ['--d' as string]: '1.4s',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-txt cal-lp-a-txt--val cal-lp-a-in"
        style={{ left: 96, top: 196, fontSize: 14, fontWeight: 700, ['--d' as string]: '2.2s', ['--t' as string]: '6s' }}
      >
        Ship it faster
      </span>
      <span
        className="cal-lp-a-box cal-lp-a-in"
        style={{
          left: 216,
          top: 190,
          width: 62,
          height: 22,
          borderRadius: 4,
          background: tint('#9b59b6'),
          borderColor: 'transparent',
          ['--d' as string]: '3.0s',
          ['--t' as string]: '6s',
        }}
      />
      <span
        className="cal-lp-a-line cal-lp-a-grow"
        style={{ left: 96, top: 220, width: 150, transformOrigin: 'left', ['--d' as string]: '2.6s', ['--t' as string]: '6s' }}
      />

      {/* A numbered comment pin, the way CommentsOverlay draws one. */}
      <span
        className="cal-lp-a-av cal-lp-a-blink"
        style={{
          left: 196,
          top: 96,
          width: 15,
          height: 15,
          fontSize: 7.5,
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
              fontSize: 7,
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

      {/* The zoom pill, parked at the bottom centre of the canvas. */}
      <span
        className="cal-lp-a-box"
        style={{
          left: (L + PANEL_X) / 2 - 34,
          top: BODY_BOTTOM - 24,
          width: 68,
          height: 17,
          borderRadius: 5,
          background: 'var(--cal-lp-bg-1)',
          ...ROW,
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <span style={{ ...TXT, fontSize: 8, color: 'var(--cal-lp-text-faint)' }}>+</span>
        <span style={{ ...TXT, fontSize: 7.5, fontWeight: 600, color: 'var(--cal-lp-text)' }}>100%</span>
        <span style={{ ...TXT, fontSize: 8, color: 'var(--cal-lp-text-faint)' }}>−</span>
        <span style={{ ...TXT, fontSize: 7.5, fontWeight: 600, color: 'var(--cal-lp-text)' }}>1:1</span>
      </span>

      {/* ── Inspector ───────────────────────────────────────────────── */}
      <span
        className="cal-lp-a-pane"
        style={{
          left: PANEL_X,
          top: BODY_TOP,
          width: PANEL_W,
          height: BODY_BOTTOM - BODY_TOP,
          border: 'none',
          borderRadius: 0,
        }}
      />
      <span className="cal-lp-a-line" style={{ left: PANEL_X, top: BODY_TOP, width: 1, height: BODY_BOTTOM - BODY_TOP }} />

      {['Props', 'Layers', 'Proto'].map((t, i) => (
        <span key={t}>
          <span
            className="cal-lp-a-txt cal-lp-a-txt--head"
            style={{
              left: PANEL_X + i * (PANEL_W / 3),
              top: BODY_TOP + 8,
              width: PANEL_W / 3,
              textAlign: 'center',
              fontSize: 7,
              color: i === 0 ? 'var(--cal-lp-accent-ink)' : undefined,
            }}
          >
            {t}
          </span>
          {i === 0 && (
            <span
              className="cal-lp-a-line"
              style={{ left: PANEL_X, top: BODY_TOP + 19, width: PANEL_W / 3, height: 2, background: 'var(--cal-lp-accent)' }}
            />
          )}
        </span>
      ))}
      <span className="cal-lp-a-line" style={{ left: PANEL_X, top: BODY_TOP + 20, width: PANEL_W, height: 1 }} />

      {/* Kind badge, with Front/Back beside it. */}
      <span
        className="cal-lp-a-box"
        style={{
          left: PANEL_X + 9,
          top: BODY_TOP + 29,
          width: 30,
          height: 14,
          borderRadius: 3,
          background: 'var(--cal-lp-bg-1)',
          ...ROW,
          justifyContent: 'center',
        }}
      >
        <span style={{ ...TXT, fontSize: 6.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--cal-lp-text-dim)' }}>
          RECT
        </span>
      </span>
      <Field left={PANEL_X + 45} top={BODY_TOP + 28} width={37} value="Front" center />
      <Field left={PANEL_X + 86} top={BODY_TOP + 28} width={37} value="Back" center />

      <Group top={BODY_TOP + 54}>Name</Group>
      <Field left={PANEL_X + 9} top={BODY_TOP + 65} width={PANEL_W - 18} value="rect" />

      <Group top={BODY_TOP + 91}>Position &amp; size</Group>
      {FIELDS.map(([k, v], i) => (
        <Field
          key={k}
          left={PANEL_X + 9 + (i % 2) * 58}
          top={BODY_TOP + 102 + Math.floor(i / 2) * 20}
          width={53}
          label={k}
          value={v}
        />
      ))}

      <Group top={BODY_TOP + 170}>Appearance</Group>
      <span
        className="cal-lp-a-box"
        style={{ left: PANEL_X + 9, top: BODY_TOP + 182, width: 8, height: 8, borderRadius: 2, background: 'var(--cal-lp-accent)', borderColor: 'transparent' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: PANEL_X + 21, top: BODY_TOP + 183, fontSize: 7.5 }}>
        Fill
      </span>
      <Field left={PANEL_X + 40} top={BODY_TOP + 178} width={PANEL_W - 49} value="#A5FF11" swatch />

      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: PANEL_X + 9, top: BODY_TOP + 204, fontSize: 7, letterSpacing: '0.07em' }}>
        Opacity
      </span>
      <span className="cal-lp-a-line" style={{ left: PANEL_X + 46, top: BODY_TOP + 205, width: 44, height: 3, borderRadius: 2 }} />
      <span
        className="cal-lp-a-line"
        style={{ left: PANEL_X + 46, top: BODY_TOP + 205, width: 44, height: 3, borderRadius: 2, background: 'var(--cal-lp-accent)' }}
      />
      <span className="cal-lp-a-txt cal-lp-a-txt--val" style={{ left: PANEL_X + 96, top: BODY_TOP + 202, fontSize: 7.5 }}>
        100 %
      </span>

      <Group top={BODY_TOP + 224}>Export</Group>
      <Field left={PANEL_X + 9} top={BODY_TOP + 235} width={53} value="PNG" />
      <Field left={PANEL_X + 67} top={BODY_TOP + 235} width={53} value="SVG" />

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: 20, bottom: 3, fontSize: 8.5 }}>
        Every edit is a CRDT op — no design server, and no file to merge
      </span>
    </div>
  );
}
