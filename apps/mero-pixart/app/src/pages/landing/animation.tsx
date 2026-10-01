/**
 * Mero PixArt — the hero: a tiny editor you can actually use, not a loop to
 * watch.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * What it shows is how the real editor is built, at toy scale:
 *   - Paint on the canvas (drag, or arrow keys + Space) with a brush or eraser.
 *   - Three layers, each its own record: Ada's, yours, and a fill. Hide any of
 *     them with its eye; the others are untouched.
 *   - A Hue adjustment on the selected layer. It is a filter over the layer, the
 *     pixels underneath never change — the editor's adjustments work the same
 *     way (`update_adjustments`, not a pixel rewrite).
 *   - Ada, a teammate, draws on HER layer on a gentle loop, so two people are
 *     visibly in one image even if the visitor never clicks.
 *
 * Coordinates are literal pixels against the fixed 495x341 box (STAGE_DESIGN_W
 * in LandingPage.tsx); the template scales the whole box to the stage. Colours
 * are `--cal-lp-*` tokens only, so it follows the page's light/dark theme.
 * Under `prefers-reduced-motion` Ada's drawing is shown finished and still;
 * everything stays interactive.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

const COLS = 24;
const ROWS = 18;
const CELL = 12;
const CANVAS_X = 50;
const CANVAS_Y = 32;
const PANEL_X = 352;
const PANEL_W = 129;

const SWATCHES = [
  { name: 'Green', value: 'var(--cal-lp-accent)' },
  { name: 'Ink', value: 'var(--cal-lp-text)' },
  { name: 'Grey', value: 'var(--cal-lp-text-faint)' },
  { name: 'Light grey', value: 'var(--cal-lp-border-strong)' },
];

type LayerId = 'ada' | 'you' | 'sky';
type Pixels = Record<number, string>;

const LAYERS: { id: LayerId; name: string; kind: string }[] = [
  { id: 'ada', name: 'Ada’s sketch', kind: 'raster · Ada' },
  { id: 'you', name: 'Your layer', kind: 'raster · you' },
  { id: 'sky', name: 'Backdrop', kind: 'fill' },
];

const key = (c: number, r: number) => r * COLS + c;

/** Ada's drawing, in stroke order: a sun, then a ridge under it. */
const ADA_STROKES: [number, number, string][] = (() => {
  const out: [number, number, string][] = [];
  const sun = 'var(--cal-lp-accent)';
  const ridge = 'var(--cal-lp-text-faint)';
  for (const [c, r] of [[18, 2], [19, 2], [17, 3], [18, 3], [19, 3], [20, 3], [17, 4], [18, 4], [19, 4], [20, 4], [18, 5], [19, 5]]) {
    out.push([c, r, sun]);
  }
  const heights = [12, 11, 10, 9, 8, 9, 10, 9, 8, 7, 8, 9, 10, 11];
  heights.forEach((top, i) => out.push([10 + i, top, ridge]));
  heights.forEach((top, i) => { if (top + 1 < ROWS) out.push([10 + i, top + 1, ridge]); });
  return out;
})();

const ADA_FINISHED: Pixels = Object.fromEntries(ADA_STROKES.map(([c, r, v]) => [key(c, r), v]));

/** Your layer starts with a small "hi" so there is something to hide and tint. */
const YOUR_START: Pixels = (() => {
  const px: Pixels = {};
  const ink = 'var(--cal-lp-accent)';
  for (const [c, r] of [[3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [4, 6], [5, 6], [6, 4], [6, 5], [6, 6], [6, 7], [6, 8], [8, 4], [8, 6], [8, 7], [8, 8]]) {
    px[key(c, r)] = ink;
  }
  return px;
})();

function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

const txt = (s: CSSProperties): CSSProperties => ({
  position: 'absolute',
  fontSize: 9.5,
  lineHeight: 1.2,
  color: 'var(--cal-lp-text-dim)',
  whiteSpace: 'nowrap',
  ...s,
});

const btnBase: CSSProperties = {
  position: 'absolute',
  padding: 0,
  margin: 0,
  border: '1px solid var(--cal-lp-border)',
  background: 'var(--cal-lp-bg-1)',
  color: 'var(--cal-lp-text)',
  font: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

function BrushIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18.4 2.6a2 2 0 0 1 2.9 2.9L11 15.8l-3-3z" />
      <path d="M7 14c-1.7 0-3 1.3-3 3 0 1.5-1 2.5-2 3 3.5 1 7 0 7-3a3 3 0 0 0-2-3z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L11 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      {open ? <circle cx="12" cy="12" r="3" /> : <path d="M3 3l18 18" />}
    </svg>
  );
}

export default function PixArtAnimation() {
  const reduced = useReducedMotion();
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [color, setColor] = useState(SWATCHES[0].value);
  const [selected, setSelected] = useState<LayerId>('you');
  const [visible, setVisible] = useState<Record<LayerId, boolean>>({ ada: true, you: true, sky: true });
  const [hue, setHue] = useState<Record<LayerId, number>>({ ada: 0, you: 0, sky: 0 });
  const [pixels, setPixels] = useState<Record<'ada' | 'you', Pixels>>({ ada: {}, you: YOUR_START });
  const [adaAt, setAdaAt] = useState<[number, number]>([17, 2]);
  const [focusCell, setFocusCell] = useState<[number, number] | null>(null);
  const painting = useRef(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Paint target: the selected raster layer. The fill layer has no pixels, so
  // with it selected the brush goes to your own layer.
  const target: 'ada' | 'you' = selected === 'ada' ? 'ada' : 'you';

  const paint = useCallback(
    (c: number, r: number) => {
      if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return;
      setPixels((prev) => {
        const layer = { ...prev[target] };
        if (tool === 'eraser') delete layer[key(c, r)];
        else layer[key(c, r)] = color;
        return { ...prev, [target]: layer };
      });
    },
    [color, tool, target],
  );

  // Ada, drawing on her own layer. Stroke by stroke, then a pause, then again.
  useEffect(() => {
    if (reduced) {
      setPixels((p) => ({ ...p, ada: ADA_FINISHED }));
      setAdaAt([ADA_STROKES[ADA_STROKES.length - 1][0], ADA_STROKES[ADA_STROKES.length - 1][1]]);
      return;
    }
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(step, 1000);
        return;
      }
      if (i < ADA_STROKES.length) {
        const [c, r, v] = ADA_STROKES[i++];
        setAdaAt([c, r]);
        setPixels((p) => ({ ...p, ada: { ...p.ada, [key(c, r)]: v } }));
        timer = setTimeout(step, 230);
      } else {
        // Hold the finished sketch, then start it again on a clean layer.
        timer = setTimeout(() => {
          i = 0;
          setPixels((p) => ({ ...p, ada: {} }));
          step();
        }, 3200);
      }
    };
    timer = setTimeout(step, 700);
    return () => clearTimeout(timer);
  }, [reduced]);

  const cellAt = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    // The whole box is CSS-scaled, so measure in screen pixels.
    const rect = e.currentTarget.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * COLS);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * ROWS);
    return [c, r];
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    painting.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    paint(...cellAt(e));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (painting.current) paint(...cellAt(e));
  };
  const onUp = () => {
    painting.current = false;
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const [c, r] = focusCell ?? [COLS >> 1, ROWS >> 1];
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dc, dr] = moves[e.key];
      const next: [number, number] = [Math.min(COLS - 1, Math.max(0, c + dc)), Math.min(ROWS - 1, Math.max(0, r + dr))];
      setFocusCell(next);
      if (e.shiftKey) paint(...next);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setFocusCell([c, r]);
      paint(c, r);
    }
  };

  const layerStyle = (id: LayerId): CSSProperties => ({
    position: 'absolute',
    inset: 0,
    display: visible[id] ? 'block' : 'none',
    filter: hue[id] ? `hue-rotate(${hue[id]}deg)` : undefined,
    pointerEvents: 'none',
  });

  const renderPixels = (px: Pixels) =>
    Object.entries(px).map(([k, v]) => {
      const n = Number(k);
      return (
        <span
          key={k}
          style={{ position: 'absolute', left: (n % COLS) * CELL, top: Math.floor(n / COLS) * CELL, width: CELL, height: CELL, background: v }}
        />
      );
    });

  const selectedName = LAYERS.find((l) => l.id === selected)!.name;

  return (
    <div className="cal-lp-a" style={{ fontFamily: 'var(--cal-lp-font)' }}>
      <span style={txt({ left: 20, top: 11, fontWeight: 600, color: 'var(--cal-lp-text)' })}>
        poster.png · {COLS} × {ROWS}
      </span>
      <span
        style={txt({
          right: 14, top: 8, padding: '2px 7px', borderRadius: 999,
          background: 'var(--cal-lp-accent-soft)', color: 'var(--cal-lp-text)', fontWeight: 600,
        })}
      >
        {reduced ? 'Ada is in this image' : 'Ada is editing'}
      </span>

      {/* Tools and colours. */}
      {(['brush', 'eraser'] as const).map((t, i) => (
        <button
          key={t}
          type="button"
          aria-label={t === 'brush' ? 'Brush' : 'Eraser'}
          aria-pressed={tool === t}
          title={t === 'brush' ? 'Brush' : 'Eraser'}
          onClick={() => setTool(t)}
          style={{
            ...btnBase, left: 14, top: CANVAS_Y + i * 30, width: 26, height: 26, borderRadius: 6,
            ...(tool === t ? { background: 'var(--cal-lp-accent)', color: 'var(--cal-lp-accent-text)', borderColor: 'transparent' } : {}),
          }}
        >
          {t === 'brush' ? <BrushIcon /> : <EraserIcon />}
        </button>
      ))}
      {SWATCHES.map((s, i) => (
        <button
          key={s.name}
          type="button"
          aria-label={`Colour: ${s.name}`}
          aria-pressed={color === s.value && tool === 'brush'}
          title={s.name}
          onClick={() => { setColor(s.value); setTool('brush'); }}
          style={{
            ...btnBase, left: 17, top: CANVAS_Y + 72 + i * 26, width: 20, height: 20, borderRadius: '50%',
            background: s.value,
            boxShadow: color === s.value && tool === 'brush' ? '0 0 0 2px var(--cal-lp-bg-1), 0 0 0 3.5px var(--cal-lp-text)' : undefined,
          }}
        />
      ))}

      {/* The canvas: three stacked layers, bottom to top. */}
      <div
        ref={canvasRef}
        role="application"
        tabIndex={0}
        aria-label={`Canvas, painting on ${target === 'ada' ? 'Ada’s sketch' : 'your layer'}. Drag to paint, or use the arrow keys and press Space. Hold Shift to paint while moving.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        // The keyboard cell marker is for keyboard users only: a mouse click
        // focuses the canvas too, and a square appearing under it reads as a bug.
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) setFocusCell((f) => f ?? [COLS >> 1, ROWS >> 1]);
        }}
        onBlur={() => setFocusCell(null)}
        onKeyDown={onKey}
        style={{
          position: 'absolute', left: CANVAS_X, top: CANVAS_Y, width: COLS * CELL, height: ROWS * CELL,
          border: '1px solid var(--cal-lp-border)', boxSizing: 'content-box', borderRadius: 4, overflow: 'hidden',
          background: 'var(--cal-lp-bg-2)', cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none',
          outline: 'none',
        }}
      >
        <div style={{ ...layerStyle('sky'), background: 'linear-gradient(180deg, var(--cal-lp-accent-soft), transparent 75%)' }} />
        <div style={layerStyle('you')}>{renderPixels(pixels.you)}</div>
        <div style={layerStyle('ada')}>{renderPixels(pixels.ada)}</div>
        {/* A faint pixel grid, so it reads as a pixel canvas. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.35,
            backgroundImage:
              'linear-gradient(to right, var(--cal-lp-border) 1px, transparent 1px), linear-gradient(to bottom, var(--cal-lp-border) 1px, transparent 1px)',
            backgroundSize: `${CELL}px ${CELL}px`,
          }}
        />
        {focusCell && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: focusCell[0] * CELL, top: focusCell[1] * CELL, width: CELL, height: CELL,
              outline: '2px solid var(--cal-lp-text)', outlineOffset: -1, pointerEvents: 'none',
            }}
          />
        )}
        {/* Ada's cursor, where she is painting. */}
        {visible.ada && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: adaAt[0] * CELL + CELL * 0.6, top: adaAt[1] * CELL + CELL * 0.6,
              transition: reduced ? undefined : 'left 0.22s ease-out, top 0.22s ease-out', pointerEvents: 'none',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path d="M4 2.5l6.5 18 2.4-7.4 7.6-2.6z" fill="var(--cal-lp-text)" stroke="var(--cal-lp-bg-1)" strokeWidth="2" strokeLinejoin="round" />
            </svg>
            <span
              style={{
                position: 'absolute', left: 9, top: 9, fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3,
                background: 'var(--cal-lp-text)', color: 'var(--cal-lp-bg-1)', whiteSpace: 'nowrap',
              }}
            >
              Ada
            </span>
          </span>
        )}
      </div>

      <span style={txt({ left: CANVAS_X, top: CANVAS_Y + ROWS * CELL + 9, width: COLS * CELL, whiteSpace: 'normal', color: 'var(--cal-lp-text-faint)' })}>
        Drag to paint. Ada draws on her own layer at the same time.
      </span>

      {/* Layers. */}
      <span style={txt({ left: PANEL_X, top: CANVAS_Y - 1, fontWeight: 600, color: 'var(--cal-lp-text)' })}>Layers</span>
      {LAYERS.map((l, i) => {
        const top = CANVAS_Y + 16 + i * 34;
        const on = selected === l.id;
        return (
          <div key={l.id}>
            <button
              type="button"
              aria-pressed={on}
              aria-label={`Select layer ${l.name}`}
              onClick={() => setSelected(l.id)}
              style={{
                ...btnBase, left: PANEL_X, top, width: PANEL_W, height: 30, borderRadius: 6,
                justifyContent: 'flex-start', paddingLeft: 26, flexDirection: 'column', alignItems: 'flex-start',
                ...(on ? { background: 'var(--cal-lp-accent-soft)', borderColor: 'var(--cal-lp-accent)' } : {}),
                opacity: visible[l.id] ? 1 : 0.55,
              }}
            >
              <span style={{ fontSize: 9.5, fontWeight: 600, lineHeight: 1.25, marginTop: 4 }}>{l.name}</span>
              <span style={{ fontSize: 8, color: 'var(--cal-lp-text-faint)', lineHeight: 1.25 }}>{l.kind}</span>
            </button>
            <button
              type="button"
              aria-label={`${visible[l.id] ? 'Hide' : 'Show'} layer ${l.name}`}
              aria-pressed={!visible[l.id]}
              title={visible[l.id] ? 'Hide layer' : 'Show layer'}
              onClick={() => setVisible((v) => ({ ...v, [l.id]: !v[l.id] }))}
              style={{
                ...btnBase, left: PANEL_X + 5, top: top + 8, width: 16, height: 16, borderRadius: 4,
                border: 'none', background: 'transparent', color: visible[l.id] ? 'var(--cal-lp-text)' : 'var(--cal-lp-text-faint)',
              }}
            >
              <EyeIcon open={visible[l.id]} />
            </button>
          </div>
        );
      })}

      {/* One live, non-destructive adjustment on the selected layer. */}
      <label
        htmlFor="cal-lp-pixart-hue"
        style={txt({ left: PANEL_X, top: CANVAS_Y + 124, fontWeight: 600, color: 'var(--cal-lp-text)', maxWidth: PANEL_W, overflow: 'hidden', textOverflow: 'ellipsis' })}
      >
        Hue · {selectedName}
      </label>
      <span style={txt({ right: 14, top: CANVAS_Y + 124, fontVariantNumeric: 'tabular-nums' })}>{hue[selected]}°</span>
      <input
        id="cal-lp-pixart-hue"
        type="range"
        min={-180}
        max={180}
        step={1}
        value={hue[selected]}
        onChange={(e) => setHue((h) => ({ ...h, [selected]: Number(e.target.value) }))}
        style={{ position: 'absolute', left: PANEL_X, top: CANVAS_Y + 140, width: PANEL_W, margin: 0, accentColor: 'var(--cal-lp-accent)' }}
      />
      <button
        type="button"
        onClick={() => setHue((h) => ({ ...h, [selected]: 0 }))}
        disabled={hue[selected] === 0}
        style={{ ...btnBase, left: PANEL_X, top: CANVAS_Y + 162, width: 60, height: 22, borderRadius: 6, fontSize: 9, opacity: hue[selected] === 0 ? 0.5 : 1 }}
      >
        Reset
      </button>
      <button
        type="button"
        aria-label={`Clear ${target === 'ada' ? 'Ada’s sketch' : 'your layer'}`}
        onClick={() => setPixels((p) => ({ ...p, [target]: {} }))}
        style={{ ...btnBase, left: PANEL_X + 66, top: CANVAS_Y + 162, width: PANEL_W - 66, height: 22, borderRadius: 6, fontSize: 9 }}
      >
        Clear layer
      </button>
      <span style={txt({ left: PANEL_X, top: CANVAS_Y + 192, width: PANEL_W, whiteSpace: 'normal', color: 'var(--cal-lp-text-faint)', fontSize: 8.5 })}>
        The hue is a setting on the layer. Its pixels never change, so Reset brings them straight back.
      </span>

      <span style={txt({ left: 20, bottom: 10, fontSize: 8.5, color: 'var(--cal-lp-text-faint)' })}>
        Every layer its own record · adjustments are non-destructive · pixels on your node
      </span>
    </div>
  );
}
