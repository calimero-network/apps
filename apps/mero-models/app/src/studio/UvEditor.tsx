import { useEffect, useMemo, useRef, useState } from "react";
import * as cmd from "../editor/commands";
import { checkerCanvas } from "../editor/checker";
import { facesOfVerts, type Poly } from "../editor/poly";
import { polyOf, shapeFromPoly } from "../editor/polymesh";
import { activeObject, useEditor, type Snapshot } from "../editor/store";
import { faceStretch, transformUvs, uvIslands, uvStats } from "../editor/uv";
import { useStudio } from "./StudioContext";

const SIZES = [512, 1024, 2048, 4096];

/** The 2D UV editor, beside the 3D view while it is open. */
export function UvEditor() {
  const open = useEditor((s) => s.uvEditor);
  return open ? <UvPanel /> : null;
}

type Drag =
  | { kind: "pan"; x: number; y: number; cx: number; cy: number }
  | { kind: "move"; start: [number, number]; base: Poly; faces: Set<number>; id: string; before: Snapshot; moved: boolean }
  | { kind: "box"; start: [number, number]; now: [number, number]; x: number; y: number; moved: boolean; add: boolean };

function UvPanel() {
  const state = useEditor();
  const { textures } = useStudio();
  const active = activeObject(state);
  const shape = active ? state.meshes.get(active.id)?.shape : undefined;
  const poly = useMemo(() => (shape ? polyOf(shape) : null), [shape]);
  const editing = state.mode === "edit" && state.role !== "viewer";
  const selected = useMemo(() => {
    if (!poly) return new Set<number>();
    return state.selectMode === "face" ? state.faceSelection : facesOfVerts(poly, state.vertexSelection);
  }, [poly, state.selectMode, state.faceSelection, state.vertexSelection]);
  const stats = useMemo(() => (poly?.uvs ? uvStats(poly) : null), [poly]);
  const stretch = useMemo(() => (poly?.uvs && state.uvStretch ? faceStretch(poly) : null), [poly, state.uvStretch]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef({ cx: 0.5, cy: 0.5, zoom: 0 });
  const drag = useRef<Drag | null>(null);
  const [, redraw] = useState(0);
  const [image, setImage] = useState<CanvasImageSource | null>(null);

  // The material's base colour texture behind the layout, when it has one.
  const mapRef = active ? state.textures.get(active.material.base_color_map) : undefined;
  useEffect(() => {
    if (!mapRef || !textures) {
      setImage(null);
      return;
    }
    const pick = () => setImage((textures.get(mapRef, "srgb")?.image as CanvasImageSource | undefined) ?? null);
    pick();
    return textures.onChange(pick);
  }, [mapRef, textures]);

  // Keep the canvas sharp at its laid-out size.
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      el.width = Math.max(1, Math.round(r.width * dpr));
      el.height = Math.max(1, Math.round(r.height * dpr));
      if (!view.current.zoom) view.current.zoom = Math.min(r.width, r.height) * 0.85;
      redraw((n) => n + 1);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    fit();
    return () => ro.disconnect();
  }, []);

  const toScreen = (u: number, v: number): [number, number] => {
    const el = canvas.current!;
    const dpr = el.width / Math.max(1, el.getBoundingClientRect().width);
    const { cx, cy, zoom } = view.current;
    return [((u - cx) * zoom) * dpr + el.width / 2, el.height / 2 - (v - cy) * zoom * dpr];
  };
  const toUv = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    const { cx, cy, zoom } = view.current;
    return [cx + (clientX - r.left - r.width / 2) / zoom, cy - (clientY - r.top - r.height / 2) / zoom];
  };

  // ── drawing ──
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    ctx.fillStyle = "#17181b";
    ctx.fillRect(0, 0, el.width, el.height);
    const [x0, y1] = toScreen(0, 1);
    const [x1, y0] = toScreen(1, 0);
    ctx.globalAlpha = image ? 0.85 : 0.35;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(state.uvChecker || !image ? checkerCanvas() : image, x0, y1, x1 - x0, y0 - y1);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      const [gx] = toScreen(i / 4, 0);
      const [, gy] = toScreen(0, i / 4);
      ctx.beginPath();
      ctx.moveTo(gx, y1);
      ctx.lineTo(gx, y0);
      ctx.moveTo(x0, gy);
      ctx.lineTo(x1, gy);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.strokeRect(x0, y1, x1 - x0, y0 - y1);
    if (!poly?.uvs) return;
    const path = (f: number) => {
      const uv = poly.uvs![f]!;
      for (let i = 0; i < uv.length; i += 2) {
        const [sx, sy] = toScreen(uv[i]!, uv[i + 1]!);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    };
    if (stretch) {
      poly.faces.forEach((_, f) => {
        const s = Math.min(1, Math.abs(stretch[f]!));
        // Blue is even; red is badly stretched or squashed.
        ctx.fillStyle = `hsla(${220 - 220 * s} 85% 55% / 0.55)`;
        ctx.beginPath();
        path(f);
        ctx.fill();
      });
    }
    ctx.beginPath();
    poly.faces.forEach((_, f) => {
      if (!selected.has(f)) path(f);
    });
    ctx.strokeStyle = "rgba(225,228,236,0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    for (const f of selected) if (poly.uvs[f]) path(f);
    ctx.fillStyle = "rgba(255,154,31,0.28)";
    ctx.fill();
    ctx.strokeStyle = "#ff9a1f";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const d = drag.current;
    if (d?.kind === "box" && d.moved) {
      const [ax, ay] = toScreen(...d.start);
      const [bx, by] = toScreen(...d.now);
      ctx.strokeStyle = "#4f9dff";
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
      ctx.setLineDash([]);
    }
  });

  // ── picking ──
  const faceAt = (u: number, v: number): number => {
    if (!poly?.uvs) return -1;
    for (let f = poly.faces.length - 1; f >= 0; f -= 1) {
      const uv = poly.uvs[f]!;
      let inside = false;
      for (let i = 0, j = uv.length - 2; i < uv.length; j = i, i += 2) {
        const yi = uv[i + 1]!, yj = uv[j + 1]!;
        if (yi > v !== yj > v && u < ((uv[j]! - uv[i]!) * (v - yi)) / (yj - yi) + uv[i]!) inside = !inside;
      }
      if (inside) return f;
    }
    return -1;
  };

  const select = (faces: Set<number>, add: boolean) => {
    if (!poly) return;
    const s = useEditor.getState();
    if (s.selectMode !== "face") cmd.setSelectMode("face");
    const cur = useEditor.getState().faceSelection;
    const next = add ? new Set([...cur, ...faces]) : faces;
    const verts = new Set<number>();
    for (const f of next) for (const v of poly.faces[f] ?? []) verts.add(v);
    useEditor.getState().setFaceSelection(next, verts);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (e.button === 1 || e.button === 2) {
      drag.current = { kind: "pan", x: e.clientX, y: e.clientY, cx: view.current.cx, cy: view.current.cy };
      return;
    }
    if (e.button !== 0 || !editing || !poly?.uvs || !active) return;
    const at = toUv(e.clientX, e.clientY);
    const hit = faceAt(...at);
    if (hit >= 0 && selected.has(hit) && !e.shiftKey) {
      drag.current = {
        kind: "move",
        start: at,
        base: poly,
        faces: new Set(selected),
        id: active.id,
        before: useEditor.getState().snapshot([], [active.id]),
        moved: false,
      };
      return;
    }
    drag.current = { kind: "box", start: at, now: at, x: e.clientX, y: e.clientY, moved: false, add: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      view.current.cx = d.cx - (e.clientX - d.x) / view.current.zoom;
      view.current.cy = d.cy + (e.clientY - d.y) / view.current.zoom;
      redraw((n) => n + 1);
      return;
    }
    const at = toUv(e.clientX, e.clientY);
    if (d.kind === "move") {
      const du = at[0] - d.start[0];
      const dv = at[1] - d.start[1];
      d.moved = d.moved || Math.abs(du) + Math.abs(dv) > 1e-4;
      const next = transformUvs(d.base, d.faces, (u, v) => [u + du, v + dv]);
      useEditor.getState().preview([], [{ id: d.id, shape: shapeFromPoly(next) }]);
      return;
    }
    d.now = at;
    d.moved = d.moved || Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4;
    redraw((n) => n + 1);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !poly) return;
    if (d.kind === "move") {
      const s = useEditor.getState();
      const shapeNow = s.meshes.get(d.id)?.shape;
      if (d.moved && shapeNow) s.commit({ puts: [], deletes: [], meshes: [{ id: d.id, shape: shapeNow }] }, "Move UVs", d.before);
      return;
    }
    if (d.kind !== "box") return;
    if (d.moved) {
      const [u0, u1] = [Math.min(d.start[0], d.now[0]), Math.max(d.start[0], d.now[0])];
      const [v0, v1] = [Math.min(d.start[1], d.now[1]), Math.max(d.start[1], d.now[1])];
      const faces = new Set<number>();
      poly.uvs?.forEach((uv, f) => {
        let u = 0, v = 0;
        for (let i = 0; i < uv.length; i += 2) (u += uv[i]!, v += uv[i + 1]!);
        u /= uv.length / 2;
        v /= uv.length / 2;
        if (u >= u0 && u <= u1 && v >= v0 && v <= v1) faces.add(f);
      });
      select(faces, d.add);
      redraw((n) => n + 1);
      return;
    }
    // A click: the island under the pointer (Ctrl for just the face).
    const hit = faceAt(...toUv(e.clientX, e.clientY));
    if (hit < 0) {
      if (!d.add) select(new Set(), false);
      return;
    }
    const island = e.ctrlKey || e.metaKey ? [hit] : (uvIslands(poly).find((i) => i.includes(hit)) ?? [hit]);
    if (d.add && island.every((f) => selected.has(f))) {
      const next = new Set(selected);
      for (const f of island) next.delete(f);
      select(next, false);
    } else {
      select(new Set(island), d.add);
    }
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const before = toUv(e.clientX, e.clientY);
    view.current.zoom = Math.min(50_000, Math.max(40, view.current.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = toUv(e.clientX, e.clientY);
    view.current.cx += before[0] - after[0];
    view.current.cy += before[1] - after[1];
    redraw((n) => n + 1);
  };

  const frame = () => {
    const el = canvas.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    view.current = { cx: 0.5, cy: 0.5, zoom: Math.min(r.width, r.height) * 0.85 };
    redraw((n) => n + 1);
  };

  const canEdit = editing && !!poly;
  const size = state.uvTextureSize;
  return (
    <section className="uv-editor" aria-label="UV editor" data-testid="uv-editor">
      <header className="uv-head">
        <span className="uv-title">UV · {active?.name ?? "nothing selected"}</span>
        <span className="vp-flex" />
        <button type="button" className="icon-btn" title="Close the UV editor" onClick={() => state.set({ uvEditor: false })}>
          ✕
        </button>
      </header>
      <div className="uv-tools">
        <button type="button" disabled={!canEdit} onClick={cmd.unwrapSelected} title="Unwrap along seams (U)" data-testid="uv-unwrap">
          Unwrap
        </button>
        <button type="button" disabled={!canEdit} onClick={cmd.smartProjectSelected} title="Project by facing; no seams needed">
          Smart project
        </button>
        <button type="button" disabled={!canEdit} onClick={cmd.packSelected} title="Pack islands into the square">
          Pack
        </button>
        <span className="tool-gap" />
        <button type="button" disabled={!canEdit} onClick={() => cmd.transformSelectedUvs("rotate")} title="Rotate 90°">⟳</button>
        <button type="button" disabled={!canEdit} onClick={() => cmd.transformSelectedUvs("flipU")} title="Flip horizontally">⇋</button>
        <button type="button" disabled={!canEdit} onClick={() => cmd.transformSelectedUvs("flipV")} title="Flip vertically">⇅</button>
        <button type="button" disabled={!canEdit} onClick={() => cmd.transformSelectedUvs("grow")} title="Scale up">＋</button>
        <button type="button" disabled={!canEdit} onClick={() => cmd.transformSelectedUvs("shrink")} title="Scale down">－</button>
        <span className="tool-gap" />
        <button type="button" className={state.uvStretch ? "on" : ""} onClick={() => state.set({ uvStretch: !state.uvStretch })} title="Colour faces by stretch">
          Stretch
        </button>
        <button type="button" onClick={frame} title="Frame the 0–1 square">Frame</button>
      </div>
      <canvas
        ref={canvas}
        className="uv-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        data-testid="uv-canvas"
      />
      <footer className="uv-foot" data-testid="uv-stats">
        {!shape ? (
          <span>{active ? "A primitive: press Tab to make it a mesh, then unwrap it." : "Select a mesh to see its UVs."}</span>
        ) : !stats ? (
          <span>No UVs yet — mark seams and Unwrap, or Smart project.</span>
        ) : (
          <>
            <span>{stats.islands} islands</span>
            <span>
              {Math.round(stats.pixelsPerMetre(size)).toLocaleString()} px/m at{" "}
              <select value={size} onChange={(e) => state.set({ uvTextureSize: Number(e.target.value) })} aria-label="Texture size">
                {SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}²
                  </option>
                ))}
              </select>
            </span>
            <span>{Math.round(Math.min(1, stats.coverage) * 100)}% of the square used</span>
            {stats.flipped > 0 && <span className="error">{stats.flipped} faces mirrored</span>}
          </>
        )}
        {!editing && shape && <span className="hint">Tab into edit mode to select and move UVs.</span>}
      </footer>
    </section>
  );
}
