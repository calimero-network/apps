/**
 * Mero Models — the studio as the app draws it: a dark viewport with a grid, a
 * cube being dragged along its gizmo's X arrow, a collaborator's selection
 * outlined in their colour, and the outliner beside it picking up the move
 * with a "replicated" tick — the claim the app exists to make.
 *
 * HAND-OWNED: `pnpm landing:generate` wires this in but never rewrites it.
 *
 * The viewport keeps the app's own dark palette in both landing themes on
 * purpose: it is the viewport the app draws.
 *
 * Coordinates are literal pixels against a 495px-wide box — see STAGE_DESIGN_W
 * in LandingPage.tsx, which scales the whole box to whatever the frame is.
 *
 * Motion follows the shared rule (see `.cal-lp-a-in` in landing.css): every
 * keyframe ends where it started and nothing uses a fill mode, so a paused
 * animation — reduced motion, a headless capture — shows the resting scene.
 */

const VP = { x: 20, y: 40, w: 300, h: 230 };
const PANEL_X = VP.x + VP.w + 14;
const PANEL_W = 495 - PANEL_X - 20;

/** An isometric cube as three faces, centred on (cx, cy), `s` across. */
function Cube({ cx, cy, s, tint }: { cx: number; cy: number; s: number; tint: [string, string, string] }) {
  const h = s / 2;
  const q = s / 4;
  return (
    <g>
      <path d={`M${cx} ${cy - h} L${cx + h} ${cy - q} L${cx} ${cy} L${cx - h} ${cy - q} Z`} fill={tint[0]} />
      <path d={`M${cx - h} ${cy - q} L${cx} ${cy} L${cx} ${cy + h} L${cx - h} ${cy + q} Z`} fill={tint[1]} />
      <path d={`M${cx} ${cy} L${cx + h} ${cy - q} L${cx + h} ${cy + q} L${cx} ${cy + h} Z`} fill={tint[2]} />
    </g>
  );
}

const STYLE = `
.mm-vp { position: absolute; border-radius: 8px; overflow: hidden; background: #24262b; box-shadow: 0 14px 30px -14px rgba(0,0,0,.55), 0 0 0 1px rgba(0,0,0,.25); }
.mm-vp svg { position: absolute; inset: 0; }
.mm-slide { animation: mm-slide 6s ease-in-out infinite; }
@keyframes mm-slide {
  0%, 100% { transform: none; }
  12%      { transform: none; }
  34%      { transform: translate(46px, 23px); }
  70%      { transform: translate(46px, 23px); }
  86%      { transform: none; }
}
.mm-chip { position: absolute; display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 6px; background: rgba(27,28,31,.9); border: 1px solid #46474f; color: #e3e4e8; font: 600 8.5px/1 var(--cal-lp-font); }
.mm-chip b { color: #ff9a1f; font-weight: 700; }
.mm-peer { position: absolute; padding: 2px 7px; border-radius: 99px; background: #4f9dff; color: #111; font: 700 8px/1.2 var(--cal-lp-font); }
.mm-panel { position: absolute; border-radius: 10px; background: var(--cal-lp-bg-1); border: 1px solid var(--cal-lp-border); box-shadow: var(--cal-lp-shadow-sm); }
.mm-head { position: absolute; font: 700 7.5px/1 var(--cal-lp-font); letter-spacing: .1em; text-transform: uppercase; color: var(--cal-lp-text-faint); }
.mm-row { position: absolute; display: flex; align-items: center; gap: 6px; height: 18px; padding: 0 6px; border-radius: 4px; font: 600 10px/1 var(--cal-lp-font); color: var(--cal-lp-text); }
.mm-row i { width: 8px; height: 8px; border-radius: 2px; background: #f0a65a; }
.mm-row--sel { background: var(--cal-lp-accent-soft); }
.mm-dot { margin-left: auto; width: 6px; height: 6px; border-radius: 50%; background: #4f9dff; }
.mm-rule { position: absolute; height: 1px; background: var(--cal-lp-border); }
.mm-field { position: absolute; display: grid; grid-template-columns: 34px 1fr; align-items: center; font: 600 9px/1 var(--cal-lp-font); color: var(--cal-lp-text-dim); }
.mm-field b { padding: 4px 6px; border-radius: 4px; background: var(--cal-lp-bg-2, rgba(0,0,0,.04)); color: var(--cal-lp-text); text-align: right; font-weight: 600; }
.mm-tick { position: absolute; display: flex; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 99px; background: var(--cal-lp-accent-soft); color: var(--cal-lp-text); font: 600 9px/1 var(--cal-lp-font); }
.mm-tick i { width: 12px; height: 12px; border-radius: 50%; background: var(--cal-lp-accent); color: var(--cal-lp-accent-text); display: grid; place-items: center; font: 800 8px/1 var(--cal-lp-font); font-style: normal; }
`;

/** The ground grid, in isometric projection around the viewport's centre. */
function Grid() {
  const lines = [];
  const cx = VP.w / 2;
  const cy = VP.h / 2 + 30;
  for (let i = -6; i <= 6; i += 1) {
    const a = { x: cx + i * 20 - 6 * 20, y: cy + i * 10 + 6 * 10 };
    const b = { x: cx + i * 20 + 6 * 20, y: cy + i * 10 - 6 * 10 };
    const c = { x: cx + i * 20 - 6 * 20, y: cy - i * 10 - 6 * 10 };
    const d = { x: cx + i * 20 + 6 * 20, y: cy - i * 10 + 6 * 10 };
    lines.push(<line key={`a${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={i === 0 ? "#c0474d" : "#3a3d44"} strokeWidth={1} />);
    lines.push(<line key={`b${i}`} x1={c.x} y1={c.y} x2={d.x} y2={d.y} stroke={i === 0 ? "#3f72c7" : "#3a3d44"} strokeWidth={1} />);
  }
  return <g opacity={0.9}>{lines}</g>;
}

export default function ModelsAnimation() {
  const body = { cx: 112, cy: 120 };
  const fin = { cx: 236, cy: 104 };
  return (
    <div className="cal-lp-a" aria-hidden="true">
      <style>{STYLE}</style>

      <span className="cal-lp-a-txt cal-lp-a-txt--head" style={{ left: VP.x, top: 16 }}>
        Robot · Ada is moving Body
      </span>

      <div className="mm-vp" style={{ left: VP.x, top: VP.y, width: VP.w, height: VP.h }}>
        <svg width={VP.w} height={VP.h} viewBox={`0 0 ${VP.w} ${VP.h}`}>
          <Grid />
          {/* Bea's cylinder-ish fin, outlined in her colour: her selection,
              streamed over presence. */}
          <Cube cx={fin.cx} cy={fin.cy} s={44} tint={["#9fb6d6", "#6f87a8", "#4c5f7a"]} />
          <rect x={fin.cx - 26} y={fin.cy - 26} width={52} height={50} fill="none" stroke="#4f9dff" strokeWidth={1.5} strokeDasharray="3 2" />
          {/* Ada's cube, outlined orange, sliding along X with its gizmo. */}
          <g className="mm-slide">
            <Cube cx={body.cx} cy={body.cy} s={60} tint={["#d9dbe1", "#b4b7bf", "#8d9099"]} />
            <path
              d={`M${body.cx} ${body.cy - 30} L${body.cx + 30} ${body.cy - 15} L${body.cx + 30} ${body.cy + 15} L${body.cx} ${body.cy + 30} L${body.cx - 30} ${body.cy + 15} L${body.cx - 30} ${body.cy - 15} Z`}
              fill="none"
              stroke="#ffa033"
              strokeWidth={2}
            />
            <line x1={body.cx} y1={body.cy} x2={body.cx + 44} y2={body.cy + 22} stroke="#e5484d" strokeWidth={2} />
            <path d={`M${body.cx + 50} ${body.cy + 25} l-9 -1 l4 -7 z`} fill="#e5484d" />
            <line x1={body.cx} y1={body.cy} x2={body.cx} y2={body.cy - 46} stroke="#6cc04a" strokeWidth={2} />
            <path d={`M${body.cx} ${body.cy - 52} l-4 8 l8 0 z`} fill="#6cc04a" />
            <line x1={body.cx} y1={body.cy} x2={body.cx - 40} y2={body.cy + 20} stroke="#4f8dff" strokeWidth={2} />
          </g>
        </svg>
        <span className="mm-chip" style={{ left: 8, top: 8 }}>
          <b>G</b> Move · X
        </span>
        <span className="mm-peer" style={{ left: fin.cx - 20, top: fin.cy - 40 }}>
          Bea
        </span>
      </div>

      {/* The outliner and the properties of the moving object: what the
          contract stores, one record per object. */}
      <span className="mm-panel" style={{ left: PANEL_X, top: VP.y, width: PANEL_W, height: VP.h }} />
      <span className="mm-head" style={{ left: PANEL_X + 12, top: VP.y + 12 }}>
        Outliner
      </span>
      <span className="mm-row mm-row--sel" style={{ left: PANEL_X + 8, top: VP.y + 24, width: PANEL_W - 16 }}>
        <i /> Body
      </span>
      <span className="mm-row" style={{ left: PANEL_X + 8, top: VP.y + 44, width: PANEL_W - 16 }}>
        <i /> Fin
        <span className="mm-dot" />
      </span>
      <span className="mm-row" style={{ left: PANEL_X + 8, top: VP.y + 64, width: PANEL_W - 16 }}>
        <i style={{ background: "#ffe08a" }} /> Sun
      </span>
      <span className="mm-rule" style={{ left: PANEL_X + 12, top: VP.y + 92, width: PANEL_W - 24 }} />
      <span className="mm-head" style={{ left: PANEL_X + 12, top: VP.y + 102 }}>
        Location
      </span>
      <span className="mm-field" style={{ left: PANEL_X + 12, top: VP.y + 116, width: PANEL_W - 24 }}>
        <span style={{ color: "#e5484d" }}>X</span>
        <b className="cal-lp-a-in" style={{ ["--d" as string]: "2s", ["--t" as string]: "6s" }}>
          1.50
        </b>
      </span>
      <span className="mm-field" style={{ left: PANEL_X + 12, top: VP.y + 138, width: PANEL_W - 24 }}>
        <span style={{ color: "#6cc04a" }}>Y</span>
        <b>0.50</b>
      </span>

      <span
        className="mm-tick cal-lp-a-in"
        style={{ left: PANEL_X + 12, top: VP.y + VP.h - 40, ["--d" as string]: "2.4s", ["--t" as string]: "6s" }}
      >
        <i>✓</i> Move replicated to Bea
      </span>

      <span className="cal-lp-a-txt cal-lp-a-txt--dim" style={{ left: VP.x, top: VP.y + VP.h + 12, fontSize: 8.5 }}>
        No server — the scene lives on every member&rsquo;s node, and edits merge as a CRDT
      </span>
    </div>
  );
}
