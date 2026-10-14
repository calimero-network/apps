import { useEffect, useMemo, useState } from "react";
import { isSolid, type SceneObject } from "../editor/model";
import { activeObject, useEditor } from "../editor/store";
import { messageOf } from "../editor/sync";
import { SMART_MATERIALS, SUGGESTED, smartMaterial, type MaskSource, type SmartMaterial } from "../editor/texgen";
import { paintColour, textureObjects, type NormalSource } from "../editor/texturing";
import { NumberField, Section, Toggle } from "../ui/fields";
import { useStudio } from "./StudioContext";

const MASKS: { value: MaskSource; label: string }[] = [
  { value: "all", label: "Everywhere" },
  { value: "edges", label: "Edges" },
  { value: "cavity", label: "Cavities" },
  { value: "occlusion", label: "Occlusion" },
  { value: "top", label: "Facing up" },
  { value: "bottom", label: "Low down" },
  { value: "noise", label: "Noise" },
];

const suggestion = (o: SceneObject | undefined) => (o && SUGGESTED[o.name]) || "painted-metal";

/**
 * Texturing: bake a mesh's maps and fill its material with a smart
 * material's textures, for one object or every selected one.
 */
export function TextureSection({ canEdit }: { canEdit: boolean }) {
  const state = useEditor();
  const { sync } = useStudio();
  const solids = useMemo(
    () => state.selection.map((id) => state.objects.get(id)).filter((o): o is SceneObject => !!o && isSolid(o.kind)),
    [state.selection, state.objects],
  );
  // The active object, or the last solid picked when the active one is a light or an empty.
  const picked = activeObject(state);
  const active = picked && isSolid(picked.kind) ? picked : solids.at(-1);
  const [key, setKey] = useState(() => suggestion(active));
  const [custom, setCustom] = useState<SmartMaterial | null>(null);
  const [size, setSize] = useState(1024);
  const [samples, setSamples] = useState(16);
  const [normals, setNormals] = useState<"none" | "modifiers" | "object">("none");
  const [perObject, setPerObject] = useState(true);
  const [progress, setProgress] = useState<{ text: string; done: number } | null>(null);
  useEffect(() => {
    setKey(suggestion(active));
    setCustom(null);
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active || !isSolid(active.kind)) return null;
  const material = custom ?? smartMaterial(key);
  const shape = state.meshes.get(active.id)?.shape;
  const hasSubdivision = !!shape?.poly?.modifiers.some((m) => m.type === "subdivision" && m.on);
  const highPoly = solids.find((o) => o.id !== active.id);
  const many = solids.length > 1 && normals !== "object";
  const editLayer = (i: number, patch: Partial<SmartMaterial["layers"][number]>) => {
    const next = structuredClone(material);
    next.layers[i] = { ...next.layers[i]!, ...patch };
    setCustom(next);
  };

  async function run() {
    if (!sync || !active) return;
    const source: NormalSource =
      normals === "modifiers" ? { kind: "modifiers" } : normals === "object" && highPoly ? { kind: "object", id: highPoly.id } : { kind: "none" };
    const ids = many ? solids.map((o) => o.id) : [active.id];
    setProgress({ text: "Starting…", done: 0 });
    try {
      const n = await textureObjects(
        {
          ids,
          material: (o) => (many && perObject && !custom ? smartMaterial(suggestion(o)) : material),
          size,
          aoSamples: samples,
          normals: source,
        },
        sync,
        (text, done) => setProgress({ text, done }),
      );
      useEditor.getState().notify(`Textured ${n} object${n === 1 ? "" : "s"}. Material preview (Z) shows them lit.`);
      if (useEditor.getState().shading !== "material") useEditor.getState().set({ shading: "material" });
    } catch (e) {
      useEditor.getState().notify(messageOf(e), true);
    } finally {
      setProgress(null);
    }
  }

  return (
    <Section title="Texturing" defaultOpen={true}>
      <p className="hint">
        Bakes occlusion, worn edges and cavities into {active.name}&apos;s UV space and paints a smart material from them: base colour,
        occlusion·roughness·metal and normal textures, uploaded as the scene&apos;s assets.
      </p>
      <label className="select-field">
        <span className="num-label">Material</span>
        <select
          value={key}
          disabled={!canEdit || !!progress}
          onChange={(e) => {
            setKey(e.target.value);
            setCustom(null);
          }}
          data-testid="smart-material"
        >
          {SMART_MATERIALS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        Paint colour <span className="swatch-inline" style={{ background: paintColour(active) }} /> {paintColour(active)} — the object&apos;s
        colour fills any layer that uses it.
      </p>
      <details className="layers">
        <summary>Layers ({material.layers.length})</summary>
        {material.layers.map((l, i) => (
          <div className="tex-layer" key={`${material.key}-${i}`}>
            <div className="tex-layer-head">
              {l.color === "{color}" ? (
                <span className="swatch-inline" style={{ background: paintColour(active) }} title="The object's colour" />
              ) : (
                <input type="color" value={l.color} disabled={!canEdit} onChange={(e) => editLayer(i, { color: e.target.value })} aria-label={`${l.name} colour`} />
              )}
              <span className="tex-layer-name">{l.name}</span>
              <select value={l.mask} disabled={!canEdit} onChange={(e) => editLayer(i, { mask: e.target.value as MaskSource })} aria-label={`${l.name} mask`}>
                {MASKS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {l.invert ? `Not ${m.label.toLowerCase()}` : m.label}
                  </option>
                ))}
              </select>
            </div>
            <NumberField label="Amount" value={l.amount} step={0.01} precision={2} min={0} max={1} disabled={!canEdit} onCommit={(v) => editLayer(i, { amount: v })} />
            <NumberField label="Break-up" value={l.breakup} step={0.01} precision={2} min={0} max={1} disabled={!canEdit} onCommit={(v) => editLayer(i, { breakup: v })} />
            <NumberField label="Opacity" value={l.opacity} step={0.01} precision={2} min={0} max={1} disabled={!canEdit} onCommit={(v) => editLayer(i, { opacity: v })} />
          </div>
        ))}
        {custom && (
          <button type="button" className="ghost" onClick={() => setCustom(null)}>
            Reset to {smartMaterial(key).name}
          </button>
        )}
      </details>
      <div className="tex-row">
        <label className="select-field">
          <span className="num-label">Size</span>
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={!!progress} data-testid="texture-size">
            {[256, 512, 1024, 2048].map((s) => (
              <option key={s} value={s}>
                {s}²
              </option>
            ))}
          </select>
        </label>
        <label className="select-field">
          <span className="num-label">Occlusion</span>
          <select value={samples} onChange={(e) => setSamples(Number(e.target.value))} disabled={!!progress}>
            <option value={0}>Off</option>
            <option value={16}>16 rays</option>
            <option value={32}>32 rays</option>
            <option value={64}>64 rays</option>
          </select>
        </label>
      </div>
      <label className="select-field">
        <span className="num-label">Normals from</span>
        <select value={normals} onChange={(e) => setNormals(e.target.value as typeof normals)} disabled={!!progress}>
          <option value="none">Nothing (bump only)</option>
          <option value="modifiers" disabled={!hasSubdivision}>
            Its subdivision (then turned off)
          </option>
          <option value="object" disabled={!highPoly}>
            {highPoly ? `High-poly: ${highPoly.name}` : "A high-poly (select it too)"}
          </option>
        </select>
      </label>
      {many && <Toggle label="Suggested material for each object" checked={perObject} onChange={setPerObject} />}
      {progress ? (
        <div className="tex-progress" role="progressbar" aria-valuenow={Math.round(progress.done * 100)} data-testid="texture-progress">
          <div className="tex-bar" style={{ width: `${Math.round(progress.done * 100)}%` }} />
          <span>{progress.text}</span>
        </div>
      ) : (
        <div className="button-row">
          <button type="button" className="primary" disabled={!canEdit || !sync} onClick={() => void run()} data-testid="generate-textures">
            {many ? `Texture ${solids.length} objects` : "Bake & texture"}
          </button>
        </div>
      )}
    </Section>
  );
}
