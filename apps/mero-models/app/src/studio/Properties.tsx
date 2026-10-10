import { useMemo, useRef } from "react";
import {
  applyTransforms,
  convertToMesh,
  decimateSelection,
  deleteSelectedVertices,
  dropToGround,
  extrudeSelected,
  flipSelection,
  mergeSelectedVertices,
  originToGeometry,
  renameObject,
  resetTransform,
  selectAll,
  setParent,
  smoothSelectedVertices,
  smoothSelection,
  subdivideActive,
  subdivideSelection,
  toggleEditMode,
} from "../editor/commands";
import { triangleCount, vertexCount } from "../editor/geometry";
import {
  cloneObject,
  descendants,
  isCurved,
  isLight,
  isSolid,
  kindLabel,
  resolvedParent,
  type Environment,
  type SceneObject,
} from "../editor/model";
import { activeObject, useEditor, type Snapshot } from "../editor/store";
import { ColorField, NumberField, Section, Toggle } from "../ui/fields";

const DEG = 180 / Math.PI;

/**
 * Everything about the selection that is a number, a colour or a switch.
 *
 * Transforms edit the ACTIVE object (the last one picked), as in Blender;
 * material, light and visibility settings apply to every selected object that
 * has them. With nothing selected, the panel shows the scene itself.
 */
export function Properties({ onEnvironment }: { onEnvironment: (env: Environment) => void }) {
  const state = useEditor();
  const active = activeObject(state);
  const canEdit = state.role !== "viewer";
  const snap = useRef<Snapshot | null>(null);

  const selected = useMemo(
    () => state.selection.map((id) => state.objects.get(id)).filter((o): o is SceneObject => !!o),
    [state.selection, state.objects],
  );

  /** Begin, preview and commit an edit of `ids` as one undo step. */
  const edit = (ids: string[], label: string, patch: (o: SceneObject, v: never) => void) => ({
    onBegin: () => {
      snap.current = useEditor.getState().snapshot(ids);
    },
    onPreview: (v: unknown) => {
      const s = useEditor.getState();
      s.preview(ids.map((id) => s.objects.get(id)).filter((o): o is SceneObject => !!o).map((o) => {
        const next = cloneObject(o);
        patch(next, v as never);
        return next;
      }));
    },
    onCommit: (v: unknown) => {
      const s = useEditor.getState();
      const puts = ids
        .map((id) => s.objects.get(id))
        .filter((o): o is SceneObject => !!o)
        .map((o) => {
          const next = cloneObject(o);
          patch(next, v as never);
          return next;
        });
      s.commit({ puts, deletes: [], meshes: [] }, label, snap.current ?? undefined);
      snap.current = null;
    },
  });

  if (!active) return <SceneSettings onEnvironment={onEnvironment} canEdit={canEdit} />;

  const ids = selected.map((o) => o.id);
  const solids = selected.filter((o) => isSolid(o.kind)).map((o) => o.id);
  const lights = selected.filter((o) => isLight(o.kind)).map((o) => o.id);
  const mesh = active.kind === "mesh" ? state.meshes.get(active.id)?.shape : undefined;

  if (state.mode === "edit") {
    return (
      <div className="properties">
        <PanelHead obj={active} count={selected.length} canEdit={canEdit} />
        <Section title="Edit mode">
          <p className="hint">
            {state.vertexSelection.size} of {mesh ? vertexCount(mesh).toLocaleString() : 0} vertices selected. Click a
            vertex, Shift-click to add, drag a box with the Select tool (W).
          </p>
          <div className="button-grid">
            <button onClick={selectAll}>Select all (A)</button>
            <button disabled={!canEdit} onClick={extrudeSelected}>Extrude (E)</button>
            <button disabled={!canEdit} onClick={mergeSelectedVertices}>Merge (M)</button>
            <button disabled={!canEdit} onClick={smoothSelectedVertices}>Smooth</button>
            <button disabled={!canEdit} onClick={subdivideActive}>Subdivide</button>
            <button disabled={!canEdit} className="danger" onClick={deleteSelectedVertices}>Delete (X)</button>
          </div>
        </Section>
        {mesh && <MeshStats positions={mesh.positions.length / 3} triangles={triangleCount(mesh)} />}
      </div>
    );
  }

  const v3 = (part: "position" | "rotation" | "scale", label: string, step: number, scale = 1) => (
    <div className="vec-row">
      <span className="vec-label">{label}</span>
      {(["x", "y", "z"] as const).map((axis) => (
        <NumberField
          key={axis}
          axis={axis}
          label={axis.toUpperCase()}
          value={active[part][axis] * scale}
          step={step}
          precision={part === "rotation" ? 1 : 3}
          suffix={part === "rotation" ? "°" : ""}
          disabled={!canEdit}
          {...edit([active.id], `${label} ${axis.toUpperCase()}`, (o, v: number) => {
            o[part][axis] = v / scale;
          })}
        />
      ))}
    </div>
  );

  const parentOptions = [...state.objects.values()].filter(
    (o) => o.id !== active.id && !descendants(active.id, state.objects).includes(o.id),
  );

  return (
    <div className="properties">
      <PanelHead obj={active} count={selected.length} canEdit={canEdit} />

      <Section title="Transform">
        {v3("position", "Location", 0.1)}
        {v3("rotation", "Rotation", 5, DEG)}
        {v3("scale", "Scale", 0.05)}
        <div className="button-row">
          <button disabled={!canEdit} onClick={() => resetTransform("position")} title="Alt+G">Clear location</button>
          <button disabled={!canEdit} onClick={() => resetTransform("rotation")} title="Alt+R">Clear rotation</button>
          <button disabled={!canEdit} onClick={() => resetTransform("scale")} title="Alt+S">Clear scale</button>
        </div>
        <div className="button-row">
          <button disabled={!canEdit} onClick={dropToGround}>Drop to ground</button>
        </div>
      </Section>

      <Section title="Relations" defaultOpen={false}>
        <label className="select-field">
          <span className="num-label">Parent</span>
          <select
            disabled={!canEdit}
            value={resolvedParent(active, state.objects)}
            onChange={(e) => setParent([active.id], e.target.value, e.target.value ? "Parent" : "Clear parent")}
          >
            <option value="">— none —</option>
            {parentOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          label="Visible"
          checked={active.visible}
          disabled={!canEdit}
          onChange={(visible) => edit(ids, visible ? "Show" : "Hide", (o, v: boolean) => (o.visible = v)).onCommit(visible)}
        />
      </Section>

      {isSolid(active.kind) && (
        <Section title="Shape">
          <p className="hint">
            {kindLabel(active.kind)}
            {active.kind === "mesh" && mesh && ` · ${vertexCount(mesh).toLocaleString()} vertices · ${triangleCount(mesh).toLocaleString()} triangles`}
          </p>
          {isCurved(active.kind) && (
            <NumberField
              label={active.kind === "icosphere" ? "Subdivisions" : "Segments"}
              value={active.kind === "icosphere" ? active.segments - 1 : active.segments}
              step={active.kind === "icosphere" ? 0.2 : 1}
              precision={0}
              min={active.kind === "icosphere" ? 0 : 3}
              max={active.kind === "icosphere" ? 6 : 128}
              disabled={!canEdit}
              {...edit([active.id], "Segments", (o, v: number) => {
                o.segments = Math.round(active.kind === "icosphere" ? v + 1 : v);
              })}
            />
          )}
          <div className="button-grid">
            {active.kind !== "mesh" && (
              <button disabled={!canEdit} onClick={() => convertToMesh()}>Convert to mesh</button>
            )}
            <button disabled={!canEdit} onClick={toggleEditMode}>Edit vertices (Tab)</button>
            <button disabled={!canEdit} onClick={subdivideSelection}>Subdivide</button>
            <button disabled={!canEdit} onClick={smoothSelection}>Smooth</button>
            <button disabled={!canEdit || active.kind !== "mesh"} onClick={decimateSelection}>Decimate ½</button>
            <button disabled={!canEdit} onClick={flipSelection}>Flip normals</button>
            <button disabled={!canEdit} onClick={applyTransforms} title="Ctrl+A">Apply transforms</button>
            <button disabled={!canEdit} onClick={originToGeometry}>Origin to geometry</button>
          </div>
        </Section>
      )}

      {solids.length > 0 && (
        <Section title={solids.length > 1 ? `Material · ${solids.length} objects` : "Material"}>
          <ColorField
            label="Base colour"
            value={active.material.color}
            disabled={!canEdit}
            {...edit(solids, "Colour", (o, v: string) => (o.material.color = v))}
          />
          <NumberField
            label="Metallic"
            value={active.material.metalness}
            step={0.02}
            min={0}
            max={1}
            disabled={!canEdit}
            {...edit(solids, "Metallic", (o, v: number) => (o.material.metalness = v))}
          />
          <NumberField
            label="Roughness"
            value={active.material.roughness}
            step={0.02}
            min={0}
            max={1}
            disabled={!canEdit}
            {...edit(solids, "Roughness", (o, v: number) => (o.material.roughness = v))}
          />
          <NumberField
            label="Opacity"
            value={active.material.opacity}
            step={0.02}
            min={0}
            max={1}
            disabled={!canEdit}
            {...edit(solids, "Opacity", (o, v: number) => (o.material.opacity = v))}
          />
          <ColorField
            label="Emission"
            value={active.material.emissive}
            disabled={!canEdit}
            {...edit(solids, "Emission", (o, v: string) => (o.material.emissive = v))}
          />
          <div className="toggle-row">
            <Toggle
              label="Flat shading"
              checked={active.material.flat_shading}
              disabled={!canEdit}
              onChange={(v) => edit(solids, "Flat shading", (o, x: boolean) => (o.material.flat_shading = x)).onCommit(v)}
            />
            <Toggle
              label="Wireframe"
              checked={active.material.wireframe}
              disabled={!canEdit}
              onChange={(v) => edit(solids, "Wireframe", (o, x: boolean) => (o.material.wireframe = x)).onCommit(v)}
            />
          </div>
          <MaterialPresets disabled={!canEdit} ids={solids} />
        </Section>
      )}

      {lights.length > 0 && (
        <Section title="Light">
          <ColorField
            label="Colour"
            value={active.material.color}
            disabled={!canEdit}
            {...edit(lights, "Light colour", (o, v: string) => (o.material.color = v))}
          />
          <NumberField
            label={active.kind === "directional_light" ? "Strength" : "Power"}
            value={active.intensity}
            step={active.kind === "directional_light" ? 0.05 : 0.5}
            min={0}
            max={1000}
            disabled={!canEdit}
            {...edit(lights, "Light power", (o, v: number) => (o.intensity = v))}
          />
          <p className="hint">Lights show in Material preview (Z cycles the shading).</p>
        </Section>
      )}

      {active.kind === "mesh" && mesh && <MeshStats positions={vertexCount(mesh)} triangles={triangleCount(mesh)} />}
    </div>
  );
}

function PanelHead({ obj, count, canEdit }: { obj: SceneObject; count: number; canEdit: boolean }) {
  return (
    <div className="panel-head">
      <input
        key={obj.id + obj.name}
        className="name-input"
        defaultValue={obj.name}
        disabled={!canEdit}
        aria-label="Object name"
        onBlur={(e) => renameObject(obj.id, e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="panel-sub">
        {kindLabel(obj.kind)}
        {count > 1 && ` · ${count} selected`}
      </span>
    </div>
  );
}

function MeshStats({ positions, triangles }: { positions: number; triangles: number }) {
  return (
    <p className="hint mesh-stats">
      {positions.toLocaleString()} / 30,000 vertices · {triangles.toLocaleString()} / 60,000 triangles
    </p>
  );
}

const PRESETS: { name: string; color: string; metalness: number; roughness: number }[] = [
  { name: "Clay", color: "#c9ccd3", metalness: 0, roughness: 0.6 },
  { name: "Plastic", color: "#e5484d", metalness: 0, roughness: 0.35 },
  { name: "Rubber", color: "#2a2c31", metalness: 0, roughness: 0.9 },
  { name: "Gold", color: "#e8b04b", metalness: 1, roughness: 0.25 },
  { name: "Steel", color: "#b8bec7", metalness: 1, roughness: 0.35 },
  { name: "Copper", color: "#c77b4f", metalness: 1, roughness: 0.3 },
  { name: "Jade", color: "#4cc38a", metalness: 0.1, roughness: 0.2 },
  { name: "Ocean", color: "#3f72c7", metalness: 0.2, roughness: 0.15 },
];

function MaterialPresets({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  return (
    <div className="presets" aria-label="Material presets">
      {PRESETS.map((p) => (
        <button
          key={p.name}
          type="button"
          disabled={disabled}
          className="preset"
          title={p.name}
          style={{
            background: `radial-gradient(circle at 35% 30%, #fff ${p.metalness ? 6 : 0}%, ${p.color} ${p.roughness * 40 + 20}%, #000 140%)`,
          }}
          onClick={() => {
            const s = useEditor.getState();
            const puts = ids
              .map((id) => s.objects.get(id))
              .filter((o): o is SceneObject => !!o)
              .map((o) => ({ ...cloneObject(o), material: { ...o.material, color: p.color, metalness: p.metalness, roughness: p.roughness } }));
            s.commit({ puts, deletes: [], meshes: [] }, `Material ${p.name}`);
          }}
        />
      ))}
    </div>
  );
}

function SceneSettings({ onEnvironment, canEdit }: { onEnvironment: (env: Environment) => void; canEdit: boolean }) {
  const env = useEditor((s) => s.environment);
  const sceneName = useEditor((s) => s.sceneName);
  const objects = useEditor((s) => s.objects);
  const meshes = useEditor((s) => s.meshes);
  const role = useEditor((s) => s.role);
  const totals = useMemo(() => {
    let v = 0;
    let t = 0;
    for (const m of meshes.values()) {
      v += vertexCount(m.shape);
      t += triangleCount(m.shape);
    }
    return { v, t };
  }, [meshes]);

  const set = (patch: Partial<Environment>) => onEnvironment({ ...env, ...patch });

  return (
    <div className="properties">
      <div className="panel-head">
        <input
          key={sceneName}
          className="name-input"
          defaultValue={sceneName}
          disabled={!canEdit}
          aria-label="Scene name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name && name !== sceneName) set({ name });
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
        <span className="panel-sub">Scene</span>
      </div>
      <Section title="World">
        <ColorField label="Background" value={env.background} disabled={!canEdit} onPreview={(background) => useEditor.getState().set({ environment: { ...env, background } })} onCommit={(background) => set({ background })} />
        <ColorField label="Ambient" value={env.ambient_color} disabled={!canEdit} onPreview={(ambient_color) => useEditor.getState().set({ environment: { ...env, ambient_color } })} onCommit={(ambient_color) => set({ ambient_color })} />
        <NumberField
          label="Ambient strength"
          value={env.ambient_intensity}
          step={0.02}
          min={0}
          max={10}
          disabled={!canEdit}
          onPreview={(ambient_intensity) => useEditor.getState().set({ environment: { ...env, ambient_intensity } })}
          onCommit={(ambient_intensity) => set({ ambient_intensity })}
        />
      </Section>
      <Section title="Statistics">
        <p className="hint">
          {objects.size.toLocaleString()} objects · {meshes.size.toLocaleString()} meshes · {totals.v.toLocaleString()} vertices ·{" "}
          {totals.t.toLocaleString()} triangles
        </p>
        <p className="hint">You are {role === "admin" ? "the admin" : role === "editor" ? "an editor" : "a viewer"} of this scene.</p>
      </Section>
    </div>
  );
}
