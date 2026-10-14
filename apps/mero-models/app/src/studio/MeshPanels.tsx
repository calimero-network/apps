import { useRef } from "react";
import * as cmd from "../editor/commands";
import { MODIFIER_LABELS, defaultModifier } from "../editor/modifiers";
import { triangleTotal, vertexTotal, type Modifier } from "../editor/poly";
import { polyOf, skippedModifiers } from "../editor/polymesh";
import { activeObject, useEditor, type LastOp, type SelectMode, type Snapshot } from "../editor/store";
import { NumberField, Section, Toggle } from "../ui/fields";

const MODES: { mode: SelectMode; label: string; key: string }[] = [
  { mode: "vertex", label: "Vertex", key: "1" },
  { mode: "edge", label: "Edge", key: "2" },
  { mode: "face", label: "Face", key: "3" },
];

/** Vertex, edge or face: what a click picks in edit mode. */
export function SelectModeSwitch() {
  const selectMode = useEditor((s) => s.selectMode);
  return (
    <div className="seg" role="group" aria-label="Select mode">
      {MODES.map((m) => (
        <button
          key={m.mode}
          type="button"
          className={selectMode === m.mode ? "on" : ""}
          title={`${m.label} select (${m.key})`}
          onClick={() => cmd.setSelectMode(m.mode)}
          data-testid={`select-${m.mode}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** The edit-mode side panel: what is selected, and every tool as a button. */
export function EditModeSection({ canEdit }: { canEdit: boolean }) {
  const state = useEditor();
  const active = activeObject(state);
  const shape = active ? state.meshes.get(active.id)?.shape : undefined;
  if (!shape) return null;
  const poly = polyOf(shape);
  const counted =
    state.selectMode === "face"
      ? `${state.faceSelection.size} of ${poly.faces.length.toLocaleString()} faces`
      : `${state.vertexSelection.size} of ${vertexTotal(poly).toLocaleString()} vertices`;
  const tool = (label: string, run: () => void, key?: string, danger = false) => (
    <button disabled={!canEdit} className={danger ? "danger" : ""} onClick={run} title={key}>
      {label}
      {key ? <kbd>{key}</kbd> : null}
    </button>
  );
  return (
    <>
      <Section title="Selection">
        <SelectModeSwitch />
        <p className="hint" data-testid="edit-selection">
          {counted} selected. Alt-click an edge for its loop, Ctrl+Alt-click for its ring.
        </p>
        <div className="button-grid">
          <button onClick={cmd.selectAll}>All <kbd>A</kbd></button>
          <button onClick={cmd.selectLinked}>Linked <kbd>Ctrl L</kbd></button>
          <button onClick={() => cmd.selectLoopsOfSelection(false)} title="Alt-click an edge">Edge loop</button>
          <button onClick={() => cmd.selectLoopsOfSelection(true)} title="Ctrl+Alt-click an edge">Edge ring</button>
        </div>
        <Toggle label="X mirror while moving" checked={state.xMirror} onChange={(xMirror) => state.set({ xMirror })} />
      </Section>
      <Section title="Modelling">
        <div className="button-grid">
          {tool("Extrude", cmd.extrudeSelected, "E")}
          {tool("Inset", cmd.insetSelected, "I")}
          {tool("Bevel", cmd.bevelSelected, "Ctrl B")}
          {tool("Loop cut", cmd.loopCutSelected, "Ctrl R")}
          {tool("Knife plane", cmd.bisectSelected, "K")}
          {tool("Connect", cmd.connectSelected, "J")}
          {tool("Bridge loops", cmd.bridgeSelected)}
          {tool("Fill", cmd.fillSelected, "F")}
          {tool("Merge", cmd.mergeSelectedVertices, "M")}
          {tool("Merge by distance", cmd.mergeByDistanceSelected)}
          {tool("Dissolve", cmd.dissolveSelected, "Ctrl X")}
          {tool("Smooth", cmd.smoothSelectedVertices)}
          {tool("Subdivide", cmd.subdivideActive)}
          {tool("Symmetrize", cmd.symmetrizeActive)}
          {tool("Delete", cmd.deleteSelectedVertices, "X", true)}
        </div>
      </Section>
      <Section title="UVs">
        <p className="hint">Mark seams where the surface may be cut open (they draw in red), then unwrap. Smart project needs no seams.</p>
        <div className="button-grid">
          {tool("Mark seam", () => cmd.markSeamSelected(true))}
          {tool("Clear seam", () => cmd.markSeamSelected(false))}
          {tool("Unwrap", cmd.unwrapSelected, "U")}
          {tool("Smart project", cmd.smartProjectSelected)}
          {tool("Pack islands", cmd.packSelected)}
          {tool("Seams from islands", cmd.seamsFromIslands)}
          <button onClick={() => state.set({ uvEditor: !state.uvEditor })} data-testid="open-uv-editor">
            {state.uvEditor ? "Close UV editor" : "UV editor"}
          </button>
          <button className={state.uvChecker ? "on" : ""} onClick={() => state.set({ uvChecker: !state.uvChecker })}>
            Checker
          </button>
        </div>
      </Section>
      <Section title="Edges">
        <p className="hint">Hard edges split the shading and hold their crease under subdivision. They draw in cyan.</p>
        <div className="button-grid">
          {tool("Mark sharp", () => cmd.markSharpSelected(true))}
          {tool("Clear sharp", () => cmd.markSharpSelected(false))}
          {tool("Sharp by angle", cmd.sharpByAngleActive)}
        </div>
      </Section>
      <p className="hint mesh-stats" data-testid="cage-stats">
        Cage: {vertexTotal(poly).toLocaleString()} vertices · {poly.faces.length.toLocaleString()} faces ·{" "}
        {triangleTotal(poly).toLocaleString()} triangles
      </p>
    </>
  );
}

/**
 * The operator panel: the last mesh tool's settings, to adjust after the fact
 * (Blender's "Adjust last operation"). Dragging a number previews; letting go
 * replaces the result and saves it once.
 */
export function OperatorPanel() {
  const lastOp = useEditor((s) => s.lastOp);
  const canEdit = useEditor((s) => s.role !== "viewer");
  if (!lastOp || !canEdit) return null;
  return (
    <div className="op-panel" role="group" aria-label={`Adjust ${lastOp.label}`} data-testid="op-panel">
      <div className="op-title">{lastOp.label}</div>
      {lastOp.params.map((param) => (
        <OpField key={param.key} op={lastOp} param={param} />
      ))}
    </div>
  );
}

function OpField({ op, param }: { op: LastOp; param: LastOp["params"][number] }) {
  const value = op.values[param.key];
  const set = (v: number | boolean, final: boolean) => op.rerun({ ...op.values, [param.key]: v }, final);
  if (param.kind === "toggle") return <Toggle label={param.label} checked={!!value} onChange={(v) => set(v, true)} />;
  if (param.kind === "choice") {
    return (
      <div className="op-choice">
        <span className="num-label">{param.label}</span>
        <div className="seg">
          {param.options.map((o) => (
            <button key={o.value} type="button" className={value === o.value ? "on" : ""} onClick={() => set(o.value, true)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const clean = (v: number) => (param.integer ? Math.round(v) : v);
  return (
    <NumberField
      label={param.label}
      value={value as number}
      step={param.step}
      precision={param.integer ? 0 : Math.max(0, Math.ceil(-Math.log10(param.step)))}
      min={param.min}
      max={param.max}
      onPreview={(v) => set(clean(v), false)}
      onCommit={(v) => set(clean(v), true)}
    />
  );
}

const AXES = ["X", "Y", "Z"];

/** The modifier stack of a mesh or primitive: add, reorder, switch off, tune, apply. */
export function ModifierSection({ id, canEdit }: { id: string; canEdit: boolean }) {
  const obj = useEditor((s) => s.objects.get(id));
  const shape = useEditor((s) => s.meshes.get(id)?.shape);
  const before = useRef<Snapshot | null>(null);
  if (!obj) return null;
  const modifiers: Modifier[] = shape?.poly?.modifiers ?? [];
  const skipped = shape ? skippedModifiers(shape) : [];

  const commit = (next: Modifier[], label: string) => {
    cmd.setModifiers(id, next, label, before.current ?? undefined);
    before.current = null;
  };
  const replace = (i: number, m: Modifier) => modifiers.map((x, k) => (k === i ? m : x));
  const live = (i: number, label: string, patch: (m: Modifier, v: number) => Modifier) => ({
    onBegin: () => {
      before.current = useEditor.getState().snapshot([id], [id]);
    },
    onPreview: (v: number) => {
      const s = useEditor.getState();
      const current = s.meshes.get(id)?.shape;
      if (current) s.preview([], [{ id, shape: cmd.modifiedShape(current, replace(i, patch(modifiers[i]!, v))) }]);
    },
    onCommit: (v: number) => commit(replace(i, patch(modifiers[i]!, v)), label),
  });

  return (
    <Section
      title="Modifiers"
      actions={
        <select
          className="mod-add"
          aria-label="Add modifier"
          disabled={!canEdit || (obj.kind === "mesh" && !shape)}
          value=""
          onChange={(e) => {
            const type = e.target.value as Modifier["type"];
            if (type) commit([...modifiers, defaultModifier(type)], `Add ${MODIFIER_LABELS[type]}`);
          }}
          data-testid="add-modifier"
        >
          <option value="">+ Add</option>
          {(Object.keys(MODIFIER_LABELS) as Modifier["type"][]).map((t) => (
            <option key={t} value={t}>
              {MODIFIER_LABELS[t]}
            </option>
          ))}
        </select>
      }
    >
      {!modifiers.length && <p className="hint">None. Modifiers change what is drawn and exported without touching the cage you edit.</p>}
      {skipped.length > 0 && <p className="hint error">Skipped as too heavy: {skipped.join(", ")}.</p>}
      {modifiers.map((m, i) => (
        <div className={`modifier ${m.on ? "" : "off"}`} key={i} data-testid={`modifier-${m.type}`}>
          <div className="mod-head">
            <input
              type="checkbox"
              checked={m.on}
              disabled={!canEdit}
              aria-label={`${MODIFIER_LABELS[m.type]} on`}
              onChange={(e) => commit(replace(i, { ...m, on: e.target.checked }), `${e.target.checked ? "Enable" : "Disable"} ${MODIFIER_LABELS[m.type]}`)}
            />
            <span className="mod-name">{MODIFIER_LABELS[m.type]}</span>
            <button type="button" className="icon-btn" disabled={!canEdit || i === 0} title="Move up" onClick={() => {
              const next = modifiers.slice();
              [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
              commit(next, "Reorder modifiers");
            }}>↑</button>
            <button type="button" className="icon-btn" disabled={!canEdit} title="Remove" onClick={() => commit(modifiers.filter((_, k) => k !== i), `Remove ${MODIFIER_LABELS[m.type]}`)}>✕</button>
          </div>
          {m.type === "mirror" && (
            <>
              <div className="seg" role="group" aria-label="Mirror axis">
                {AXES.map((a, k) => (
                  <button key={a} type="button" disabled={!canEdit} className={m.axis === k ? "on" : ""} onClick={() => commit(replace(i, { ...m, axis: k as 0 | 1 | 2 }), "Mirror axis")}>
                    {a}
                  </button>
                ))}
              </div>
              <NumberField label="Weld" value={m.weld} step={0.001} precision={4} min={0} max={1} disabled={!canEdit} {...live(i, "Mirror weld", (x, v) => ({ ...x, weld: v }) as Modifier)} />
            </>
          )}
          {m.type === "subdivision" && (
            <NumberField label="Levels" value={m.levels} step={0.1} precision={0} min={1} max={4} disabled={!canEdit} {...live(i, "Subdivision levels", (x, v) => ({ ...x, levels: Math.round(v) }) as Modifier)} />
          )}
          {m.type === "array" && (
            <>
              <NumberField label="Count" value={m.count} step={0.2} precision={0} min={1} max={64} disabled={!canEdit} {...live(i, "Array count", (x, v) => ({ ...x, count: Math.round(v) }) as Modifier)} />
              <div className="vec-row">
                <span className="vec-label">Offset</span>
                {(["x", "y", "z"] as const).map((axis, k) => (
                  <NumberField
                    key={axis}
                    axis={axis}
                    label={axis.toUpperCase()}
                    value={m.offset[k]!}
                    step={0.05}
                    min={-1000}
                    max={1000}
                    disabled={!canEdit}
                    {...live(i, "Array offset", (x, v) => {
                      const offset = [...(x as typeof m).offset] as [number, number, number];
                      offset[k] = v;
                      return { ...x, offset } as Modifier;
                    })}
                  />
                ))}
              </div>
            </>
          )}
          {m.type === "solidify" && (
            <NumberField label="Thickness" value={m.thickness} step={0.005} min={-10} max={10} disabled={!canEdit} {...live(i, "Solidify thickness", (x, v) => ({ ...x, thickness: v }) as Modifier)} />
          )}
        </div>
      ))}
      {modifiers.length > 0 && (
        <div className="button-row">
          <button disabled={!canEdit} onClick={() => cmd.applyModifiers(id)}>Apply all to the cage</button>
        </div>
      )}
    </Section>
  );
}
