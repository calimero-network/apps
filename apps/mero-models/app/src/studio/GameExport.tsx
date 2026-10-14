import { useEffect, useMemo, useState } from "react";
import { shapeOf } from "../editor/commands";
import {
  ENGINES,
  buildGameExport,
  checkPlan,
  exportObjects,
  planExport,
  planTextures,
  type Collision,
  type Engine,
  type GameExportOptions,
  type PlannedMesh,
} from "../editor/gameexport";
import { download } from "../editor/io";
import { topmost } from "../editor/model";
import { useEditor } from "../editor/store";
import { messageOf } from "../editor/sync";
import { BUDGETS, type Check } from "../editor/validate";
import { useStudio } from "./StudioContext";

/**
 * File → Game export: LODs, collision and engine naming for the selection
 * (or the scene), checked against a budget before it goes.
 */
export function GameExportDialog({ onClose }: { onClose: () => void }) {
  const state = useEditor();
  const { textures } = useStudio();
  const [engine, setEngine] = useState<Engine>("unreal");
  const [format, setFormat] = useState<"fbx" | "glb">("fbx");
  const [lods, setLods] = useState(2);
  const [lodRatio, setLodRatio] = useState(0.5);
  const [collision, setCollision] = useState<Collision>("hull");
  const [budgetKey, setBudgetKey] = useState("prop");
  const roots = topmost(state.selection, state.objects);
  const [name, setName] = useState(() => (roots.length === 1 ? state.objects.get(roots[0]!)?.name : state.sceneName) || "Asset");
  const [plan, setPlan] = useState<PlannedMesh[] | null>(null);
  const [busy, setBusy] = useState(false);
  const opts: GameExportOptions = useMemo(() => ({ engine, format, lods, lodRatio, collision }), [engine, format, lods, lodRatio, collision]);
  const budget = BUDGETS.find((b) => b.key === budgetKey)!;

  // Plan off the click that opened the dialog, so it opens at once even for heavy meshes.
  useEffect(() => {
    setPlan(null);
    const timer = window.setTimeout(() => {
      const s = useEditor.getState();
      setPlan(planExport(exportObjects(s.selection, s.objects), s.objects, shapeOf, opts));
    }, 30);
    return () => window.clearTimeout(timer);
  }, [opts, state.objects, state.meshes, state.selection]);

  const textureRefs = useMemo(() => (plan ? planTextures(plan, state.textures) : []), [plan, state.textures]);
  const checks: Check[] = useMemo(() => (plan ? checkPlan(plan, textureRefs, budget) : []), [plan, textureRefs, budget]);
  const errors = checks.filter((c) => c.severity === "error").length;

  async function run() {
    if (!plan?.length) return;
    setBusy(true);
    try {
      const out = await buildGameExport(plan, checks, opts, name, textures ? { refs: state.textures, cache: textures } : null);
      download(new Blob([out.data as BlobPart], { type: out.mime }), out.filename);
      useEditor.getState().notify(`Exported ${out.filename}.`);
      onClose();
    } catch (e) {
      useEditor.getState().notify(messageOf(e), true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog wide game-export" role="dialog" aria-label="Game export" data-testid="game-export">
      <h3>Game export</h3>
      <p className="hint">
        {roots.length ? `The selection` : "The whole scene"} — {plan ? `${plan.length} mesh${plan.length === 1 ? "" : "es"}` : "planning…"} — with levels
        of detail and collision, named the way the engine picks them up on import.
      </p>
      <div className="ge-grid">
        <label>
          Asset name
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Engine
          <select value={engine} onChange={(e) => setEngine(e.target.value as Engine)} data-testid="ge-engine">
            {ENGINES.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Format
          <select value={format} onChange={(e) => setFormat(e.target.value as "fbx" | "glb")} data-testid="ge-format">
            <option value="fbx">FBX + textures (.zip)</option>
            <option value="glb">glTF binary (.glb)</option>
          </select>
        </label>
        <label>
          Levels of detail
          <select value={lods} onChange={(e) => setLods(Number(e.target.value))}>
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "LOD 0 only" : `LOD 0 – ${n}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Each LOD keeps
          <select value={lodRatio} onChange={(e) => setLodRatio(Number(e.target.value))}>
            {[0.75, 0.5, 0.35, 0.25].map((r) => (
              <option key={r} value={r}>
                {Math.round(r * 100)}% of the last
              </option>
            ))}
          </select>
        </label>
        <label>
          Collision
          <select value={collision} onChange={(e) => setCollision(e.target.value as Collision)}>
            <option value="hull">Convex hull</option>
            <option value="box">Box</option>
            <option value="none">None</option>
          </select>
        </label>
        <label>
          Budget
          <select value={budgetKey} onChange={(e) => setBudgetKey(e.target.value)} data-testid="ge-budget">
            {BUDGETS.map((b) => (
              <option key={b.key} value={b.key}>
                {b.name} · {b.triangles.toLocaleString()} tris
              </option>
            ))}
          </select>
        </label>
      </div>
      {plan && (
        <div className="ge-table" data-testid="ge-plan">
          {plan.map((p) => (
            <div className="ge-row" key={p.object.id}>
              <span className="ge-name">{p.object.name}</span>
              <span className="ge-lods">
                {p.lods.map((l) => (
                  <span key={l.name} title={l.name}>
                    {(l.shape.indices.length / 3).toLocaleString()}
                  </span>
                ))}
              </span>
              <span className="ge-col">{p.collision ? `${p.collision.shape.positions.length / 3}-point ${collision === "box" ? "box" : "hull"}` : "—"}</span>
            </div>
          ))}
        </div>
      )}
      <ul className="ge-checks" data-testid="ge-checks">
        {checks.map((c, i) => (
          <li key={i} className={c.severity}>
            <span className="ge-badge">{c.severity === "error" ? "✕" : c.severity === "warning" ? "!" : "i"}</span>
            {c.object && <strong>{c.object}: </strong>}
            {c.text}
          </li>
        ))}
      </ul>
      <div className="dialog-row end">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" disabled={!plan?.length || busy} onClick={() => void run()} data-testid="ge-export">
          {busy ? "Exporting…" : errors ? `Export anyway (${errors} over budget or broken)` : "Export"}
        </button>
      </div>
    </div>
  );
}
