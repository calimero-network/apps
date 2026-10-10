import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { clearContextId, useMero } from "@calimero-network/mero-react";
import * as cmd from "../editor/commands";
import { rememberName, storedName, useJoin, usePresence, useSceneSync } from "../editor/hooks";
import { IMPORT_ACCEPT, download, exportScene, importFile, type ExportFormat } from "../editor/io";
import { LIGHTS, PRIMITIVES, isSolid, type Environment, type ObjectKind } from "../editor/model";
import { activeObject, useEditor, type Shading, type Tool } from "../editor/store";
import { messageOf } from "../editor/sync";
import { Viewport, type Peer } from "../editor/viewport";
import {
  IconCursor,
  IconGrid,
  IconMagnet,
  IconMaterial,
  IconMove,
  IconOrtho,
  IconPerspective,
  IconRedo,
  IconRotate,
  IconScale,
  IconSolid,
  IconUndo,
  IconUsers,
  IconVertex,
  IconWire,
  KindIcon,
} from "../ui/icons";
import { MenuBar, type MenuEntry } from "../ui/Menu";
import { Outliner } from "./Outliner";
import { Properties } from "./Properties";
import { SharePanel } from "./SharePanel";

/**
 * The modeller: menu bar across the top, tools down the left, the 3D view in
 * the middle, outliner and properties on the right, status along the bottom.
 */
export function Studio({ contextId }: { contextId: string }) {
  const { sync, saving } = useSceneSync(contextId);
  const [name, setName] = useState(storedName);
  useJoin(contextId, name);
  const { peers, publishCamera } = usePresence(contextId, name);
  const viewport = useRef<Viewport | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [share, setShare] = useState(false);
  const [arrayOpen, setArrayOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const { logout } = useMero();

  const state = useEditor();
  const active = activeObject(state);
  const canEdit = state.role !== "viewer";

  const onEnvironment = useCallback(
    (env: Environment) => {
      if (!useEditor.getState().canEdit()) return;
      useEditor.getState().set({ environment: env, sceneName: env.name || useEditor.getState().sceneName });
      sync?.sendEnvironment(env);
    },
    [sync],
  );

  const onName = useCallback((next: string) => {
    setName(next);
    rememberName(next);
  }, []);

  // ── file actions ──
  async function onImport(file: File) {
    const s = useEditor.getState();
    if (!s.canEdit()) return s.notify("View only — ask the scene's admin for the editor role.", true);
    s.notify(`Importing ${file.name}…`);
    try {
      const imported = await importFile(file, [...s.objects.values()].map((o) => o.name));
      if (s.objects.size + imported.objects.length > 2_000) throw new Error("That would take the scene past 2,000 objects.");
      s.commit({ puts: imported.objects, deletes: [], meshes: imported.meshes }, `Import ${file.name}`);
      s.select([imported.objects[0]!.id]);
      viewport.current?.frameSelection(true);
      s.notify(imported.notes.length ? imported.notes.join(" ") : `Imported ${file.name}.`);
    } catch (e) {
      s.notify(messageOf(e), true);
    }
  }

  async function onExport(format: ExportFormat) {
    const s = useEditor.getState();
    try {
      await exportScene(format, s.objects, s.meshes, s.sceneName);
    } catch (e) {
      s.notify(messageOf(e), true);
    }
  }

  async function onRender() {
    const blob = await viewport.current?.capture();
    if (blob) download(blob, `${(useEditor.getState().sceneName || "render").replace(/[^\w.-]+/g, "_")}.png`);
  }

  function leave() {
    clearContextId();
    window.location.reload();
  }

  // ── menus ──
  const addItems: MenuEntry[] = [
    { heading: "Mesh" },
    ...PRIMITIVES.map((p) => ({
      label: p.label,
      icon: <KindIcon kind={p.kind} size={14} />,
      disabled: !canEdit,
      onSelect: () => cmd.addObject(p.kind),
    })),
    "separator",
    { heading: "Light" },
    ...LIGHTS.map((p) => ({
      label: p.label,
      icon: <KindIcon kind={p.kind} size={14} />,
      disabled: !canEdit,
      onSelect: () => cmd.addObject(p.kind),
    })),
    "separator",
    { label: "Empty", icon: <KindIcon kind="group" size={14} />, disabled: !canEdit, onSelect: () => cmd.addObject("group" as ObjectKind) },
  ];
  const hasSel = state.selection.length > 0;
  const editMode = state.mode === "edit";
  const menus: { name: string; items: MenuEntry[] }[] = [
    {
      name: "File",
      items: [
        { label: "Import…", shortcut: "Ctrl O", disabled: !canEdit, onSelect: () => fileInput.current?.click() },
        {
          label: "Export",
          items: [
            { label: "glTF binary (.glb)", onSelect: () => void onExport("glb") },
            { label: "Wavefront (.obj)", onSelect: () => void onExport("obj") },
            { label: "STL (.stl)", onSelect: () => void onExport("stl") },
            { label: "Mero Models scene (.json)", onSelect: () => void onExport("json") },
          ],
        },
        { label: "Render image", shortcut: "F12", onSelect: () => void onRender() },
        "separator",
        { label: "Share…", onSelect: () => setShare(true) },
        { label: "Switch scene", onSelect: leave },
        { label: "Log out", onSelect: logout },
      ],
    },
    {
      name: "Edit",
      items: [
        { label: state.past.length ? `Undo ${state.past.at(-1)!.label}` : "Undo", shortcut: "Ctrl Z", disabled: !state.past.length || !canEdit, onSelect: state.undo },
        { label: state.future.length ? `Redo ${state.future[0]!.label}` : "Redo", shortcut: "Ctrl ⇧ Z", disabled: !state.future.length || !canEdit, onSelect: state.redo },
        "separator",
        { label: "Duplicate", shortcut: "⇧ D", disabled: !hasSel || !canEdit || editMode, onSelect: () => cmd.duplicateSelection() },
        { label: "Array…", disabled: !hasSel || !canEdit || editMode, onSelect: () => setArrayOpen(true) },
        { label: "Delete", shortcut: "X", disabled: !canEdit || (!hasSel && !editMode), onSelect: cmd.deleteSelection },
        "separator",
        { label: "Select all", shortcut: "A", onSelect: cmd.selectAll },
        { label: "Select none", shortcut: "Alt A", onSelect: cmd.deselect },
        { label: "Invert selection", shortcut: "Ctrl I", onSelect: cmd.invertSelection },
        "separator",
        { label: "Hide selected", shortcut: "H", disabled: !hasSel || !canEdit, onSelect: cmd.hideSelection },
        { label: "Show all", shortcut: "Alt H", disabled: !canEdit, onSelect: cmd.unhideAll },
      ],
    },
    { name: "Add", items: addItems },
    {
      name: "Object",
      items: editMode
        ? [
            { label: "Extrude", shortcut: "E", disabled: !canEdit, onSelect: cmd.extrudeSelected },
            { label: "Merge at centre", shortcut: "M", disabled: !canEdit, onSelect: cmd.mergeSelectedVertices },
            { label: "Smooth vertices", disabled: !canEdit, onSelect: cmd.smoothSelectedVertices },
            { label: "Subdivide", disabled: !canEdit, onSelect: cmd.subdivideActive },
            { label: "Delete vertices", shortcut: "X", disabled: !canEdit, onSelect: cmd.deleteSelectedVertices },
            "separator",
            { label: "Back to object mode", shortcut: "Tab", onSelect: cmd.toggleEditMode },
          ]
        : [
            { label: "Edit vertices", shortcut: "Tab", disabled: !active || !isSolid(active.kind) || !canEdit, onSelect: cmd.toggleEditMode },
            "separator",
            { label: "Group", shortcut: "Ctrl G", disabled: !hasSel || !canEdit, onSelect: cmd.groupSelection },
            { label: "Ungroup", shortcut: "Ctrl ⇧ G", disabled: !hasSel || !canEdit, onSelect: cmd.ungroupSelection },
            { label: "Parent to active", shortcut: "Ctrl P", disabled: state.selection.length < 2 || !canEdit, onSelect: cmd.parentToActive },
            { label: "Clear parent", shortcut: "Alt P", disabled: !hasSel || !canEdit, onSelect: cmd.clearParent },
            "separator",
            { label: "Join meshes", shortcut: "Ctrl J", disabled: state.selection.length < 2 || !canEdit, onSelect: cmd.joinSelection },
            { label: "Convert to mesh", disabled: !hasSel || !canEdit, onSelect: () => cmd.convertToMesh() },
            { label: "Apply transforms", shortcut: "Ctrl A", disabled: !hasSel || !canEdit, onSelect: cmd.applyTransforms },
            { label: "Origin to geometry", disabled: !hasSel || !canEdit, onSelect: cmd.originToGeometry },
            "separator",
            {
              label: "Mesh",
              disabled: !hasSel || !canEdit,
              items: [
                { label: "Subdivide", onSelect: cmd.subdivideSelection },
                { label: "Smooth", onSelect: cmd.smoothSelection },
                { label: "Decimate ½", onSelect: cmd.decimateSelection },
                { label: "Merge by distance", onSelect: cmd.mergeSelection },
                { label: "Flip normals", onSelect: cmd.flipSelection },
              ],
            },
            {
              label: "Mirror",
              disabled: !hasSel || !canEdit,
              items: (["x", "y", "z"] as const).map((axis) => ({ label: `${axis.toUpperCase()} axis`, onSelect: () => cmd.mirrorSelection(axis) })),
            },
            { label: "Drop to ground", disabled: !hasSel || !canEdit, onSelect: cmd.dropToGround },
          ],
    },
    {
      name: "View",
      items: [
        { label: "Frame selected", shortcut: "F", onSelect: () => viewport.current?.frameSelection(true) },
        { label: "Frame all", shortcut: "Home", onSelect: () => viewport.current?.frameSelection(false) },
        "separator",
        { label: "Front", shortcut: "1", onSelect: () => viewport.current?.view("front") },
        { label: "Right", shortcut: "3", onSelect: () => viewport.current?.view("right") },
        { label: "Top", shortcut: "7", onSelect: () => viewport.current?.view("top") },
        { label: "Orthographic", shortcut: "5", checked: state.ortho, onSelect: () => state.set({ ortho: !state.ortho }) },
        "separator",
        { label: "Wireframe", checked: state.shading === "wireframe", onSelect: () => state.set({ shading: "wireframe" }) },
        { label: "Solid", checked: state.shading === "solid", onSelect: () => state.set({ shading: "solid" }) },
        { label: "Material preview", checked: state.shading === "material", onSelect: () => state.set({ shading: "material" }) },
        "separator",
        { label: "Grid", checked: state.showGrid, onSelect: () => state.set({ showGrid: !state.showGrid }) },
      ],
    },
  ];

  // ── keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const v = viewport.current;
      const handled = () => e.preventDefault();

      if (ctrl && key === "z" && !e.shiftKey) return handled(), s.undo();
      if ((ctrl && key === "z" && e.shiftKey) || (ctrl && key === "y")) return handled(), s.redo();
      if (ctrl && key === "o") return handled(), fileInput.current?.click();
      if (ctrl && key === "g" && e.shiftKey) return handled(), cmd.ungroupSelection();
      if (ctrl && key === "g") return handled(), cmd.groupSelection();
      if (ctrl && key === "j") return handled(), cmd.joinSelection();
      if (ctrl && key === "p") return handled(), cmd.parentToActive();
      if (ctrl && key === "a") return handled(), cmd.applyTransforms();
      if (ctrl && key === "i") return handled(), cmd.invertSelection();
      if (ctrl && key === "d") return handled(), cmd.duplicateSelection();
      if (ctrl) return;
      if (e.altKey) {
        if (key === "a") return handled(), cmd.deselect();
        if (key === "h") return handled(), cmd.unhideAll();
        if (key === "p") return handled(), cmd.clearParent();
        if (key === "g") return handled(), cmd.resetTransform("position");
        if (key === "r") return handled(), cmd.resetTransform("rotation");
        if (key === "s") return handled(), cmd.resetTransform("scale");
        return;
      }
      if (e.shiftKey && key === "a") return handled(), setMenu("Add");
      if (e.shiftKey && key === "d") return handled(), cmd.duplicateSelection();
      if (e.key === "Tab") return handled(), cmd.toggleEditMode();
      if (e.key === "F12") return handled(), void onRender();
      if (e.key === "Home") return handled(), v?.frameSelection(false);
      if (e.key === "Delete" || e.key === "Backspace" || key === "x") return handled(), cmd.deleteSelection();
      const tools: Record<string, Tool> = { w: "select", g: "translate", r: "rotate", s: "scale" };
      if (tools[key]) return handled(), s.setTool(tools[key]!);
      if (key === "a") return handled(), cmd.selectAll();
      if (key === "h") return handled(), cmd.hideSelection();
      if (key === "f" || e.code === "NumpadDecimal") return handled(), v?.frameSelection(true);
      if (key === "e" && s.mode === "edit") return handled(), cmd.extrudeSelected();
      if (key === "m" && s.mode === "edit") return handled(), cmd.mergeSelectedVertices();
      if (key === "z") {
        const order: Shading[] = ["solid", "material", "wireframe"];
        return handled(), s.set({ shading: order[(order.indexOf(s.shading) + 1) % order.length]! });
      }
      const digit = e.code.replace(/^(Numpad|Digit)/, "");
      if (digit === "1") return handled(), v?.view(e.shiftKey ? "back" : "front");
      if (digit === "3") return handled(), v?.view(e.shiftKey ? "left" : "right");
      if (digit === "7") return handled(), v?.view(e.shiftKey ? "bottom" : "top");
      if (digit === "5") return handled(), s.set({ ortho: !s.ortho });
      if (e.key === "Escape") return s.mode === "edit" ? s.setMode("object") : undefined;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `onRender` reads the viewport through a ref; it is stable in effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const follow = useCallback((peer: Peer) => {
    if (peer.camera && peer.target) viewport.current?.lookFrom(peer.camera, peer.target);
  }, []);

  return (
    <div className="studio" data-testid="studio">
      <header className="studio-top">
        <MenuBar menus={menus} openName={menu} onOpenChange={setMenu} />
        <div className="scene-title" title={contextId}>
          <span className="scene-name" data-testid="scene-name">{state.sceneName || "Untitled scene"}</span>
          {!canEdit && state.loaded && <span className="role-badge viewer">View only</span>}
        </div>
        <div className="top-right">
          <span className={`save-state ${saving ? "saving" : ""}`}>{saving ? "Saving…" : state.loaded ? "Saved to your node" : "Loading…"}</span>
          <div className="peer-stack">
            {peers.slice(0, 5).map((p) => (
              <button
                key={p.key}
                type="button"
                className="avatar"
                style={{ background: p.color }}
                title={`${p.name} — click to see what they see`}
                onClick={() => follow(p)}
              >
                {(p.name[0] ?? "?").toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="share-btn" onClick={() => setShare(!share)} data-testid="share">
            <IconUsers /> Share
          </button>
        </div>
      </header>

      <div className="studio-body">
        <nav className="toolbar" aria-label="Tools">
          <ToolButton tool="select" label="Select box (W)" icon={<IconCursor />} />
          <ToolButton tool="translate" label="Move (G)" icon={<IconMove />} />
          <ToolButton tool="rotate" label="Rotate (R)" icon={<IconRotate />} />
          <ToolButton tool="scale" label="Scale (S)" icon={<IconScale />} />
          <div className="tool-sep" />
          <button type="button" className="tool" title="Undo (Ctrl+Z)" disabled={!state.past.length || !canEdit} onClick={state.undo}>
            <IconUndo />
          </button>
          <button type="button" className="tool" title="Redo (Ctrl+Shift+Z)" disabled={!state.future.length || !canEdit} onClick={state.redo}>
            <IconRedo />
          </button>
          <div className="tool-sep" />
          <QuickAdd disabled={!canEdit} />
        </nav>

        <main className="viewport-wrap">
          <ViewportHost
            onReady={(v) => (viewport.current = v)}
            peers={peers}
            onCamera={(cam, target) => publishCamera(cam, target)}
          />
          <div className="vp-header">
            <div className="seg" role="group" aria-label="Mode">
              <button type="button" className={state.mode === "object" ? "on" : ""} onClick={() => state.mode !== "object" && cmd.toggleEditMode()}>
                Object
              </button>
              <button
                type="button"
                className={state.mode === "edit" ? "on" : ""}
                disabled={!active || !isSolid(active.kind) || !canEdit}
                onClick={() => state.mode !== "edit" && cmd.toggleEditMode()}
                title="Edit vertices (Tab)"
              >
                <IconVertex size={14} /> Edit
              </button>
            </div>
            <div className="seg" role="group" aria-label="Transform space">
              <button type="button" className={state.space === "world" ? "on" : ""} onClick={() => state.set({ space: "world" })}>
                Global
              </button>
              <button type="button" className={state.space === "local" ? "on" : ""} onClick={() => state.set({ space: "local" })}>
                Local
              </button>
            </div>
            <button type="button" className={`vp-btn ${state.snap ? "on" : ""}`} title="Snap (hold Ctrl while dragging)" onClick={() => state.set({ snap: !state.snap })}>
              <IconMagnet size={14} />
            </button>
            <span className="vp-flex" />
            <button type="button" className={`vp-btn ${state.showGrid ? "on" : ""}`} title="Grid" onClick={() => state.set({ showGrid: !state.showGrid })}>
              <IconGrid size={14} />
            </button>
            <button type="button" className="vp-btn" title={state.ortho ? "Orthographic (5)" : "Perspective (5)"} onClick={() => state.set({ ortho: !state.ortho })}>
              {state.ortho ? <IconOrtho size={14} /> : <IconPerspective size={14} />}
            </button>
            <div className="seg" role="group" aria-label="Shading (Z)">
              <button type="button" title="Wireframe" className={state.shading === "wireframe" ? "on" : ""} onClick={() => state.set({ shading: "wireframe" })}>
                <IconWire size={14} />
              </button>
              <button type="button" title="Solid" className={state.shading === "solid" ? "on" : ""} onClick={() => state.set({ shading: "solid" })}>
                <IconSolid size={14} />
              </button>
              <button type="button" title="Material preview" className={state.shading === "material" ? "on" : ""} onClick={() => state.set({ shading: "material" })}>
                <IconMaterial size={14} />
              </button>
            </div>
          </div>
          {state.loaded && state.objects.size === 0 && (
            <div className="vp-empty">
              <p>An empty scene.</p>
              {canEdit ? (
                <>
                  <button type="button" onClick={() => cmd.addObject("cube")}>Add a cube</button>
                  <p className="hint">or press Shift+A, or import an OBJ, STL or glTF from File.</p>
                </>
              ) : (
                <p className="hint">Nothing here yet — the scene fills in as editors build it.</p>
              )}
            </div>
          )}
          {arrayOpen && <ArrayDialog onClose={() => setArrayOpen(false)} />}
        </main>

        <aside className="sidebar">
          <div className="panel outliner-panel">
            <div className="panel-title">Outliner</div>
            <Outliner peers={peers} />
          </div>
          <div className="panel properties-panel">
            <Properties onEnvironment={onEnvironment} />
          </div>
        </aside>

        {share && (
          <SharePanel
            contextId={contextId}
            name={name}
            onName={onName}
            peers={peers}
            onFollow={follow}
            onClose={() => setShare(false)}
          />
        )}
      </div>

      <StatusBar />

      <input
        ref={fileInput}
        type="file"
        accept={IMPORT_ACCEPT}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void onImport(file);
        }}
      />
    </div>
  );
}

function ToolButton({ tool, label, icon }: { tool: Tool; label: string; icon: React.ReactNode }) {
  const current = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <button
      type="button"
      className={`tool ${current === tool ? "on" : ""}`}
      title={label}
      aria-pressed={current === tool}
      onClick={() => setTool(tool)}
      data-testid={`tool-${tool}`}
    >
      {icon}
    </button>
  );
}

function QuickAdd({ disabled }: { disabled: boolean }) {
  return (
    <>
      {(["cube", "sphere", "cylinder", "cone", "torus", "plane", "point_light"] as ObjectKind[]).map((kind) => (
        <button
          key={kind}
          type="button"
          className="tool"
          title={`Add ${kind.replace("_", " ")}`}
          disabled={disabled}
          onClick={() => cmd.addObject(kind)}
          data-testid={`add-${kind}`}
        >
          <KindIcon kind={kind} />
        </button>
      ))}
    </>
  );
}

/** Mounts the three.js viewport once and feeds it peers. */
function ViewportHost({
  onReady,
  peers,
  onCamera,
}: {
  onReady: (v: Viewport | null) => void;
  peers: Peer[];
  onCamera: (camera: [number, number, number], target: [number, number, number]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const vp = useRef<Viewport | null>(null);
  const cameraCb = useRef(onCamera);
  cameraCb.current = onCamera;

  useEffect(() => {
    if (!host.current) return;
    let pending: number | null = null;
    const v = new Viewport(host.current, {
      onCamera: (cam, target) => {
        if (pending !== null) return;
        // Presence is throttled again in mero-react; this keeps the vectors
        // from being copied on every frame of an orbit.
        pending = window.setTimeout(() => {
          pending = null;
          const r = (n: number) => Math.round(n * 100) / 100;
          cameraCb.current([r(cam.x), r(cam.y), r(cam.z)], [r(target.x), r(target.y), r(target.z)]);
        }, 200);
      },
    });
    vp.current = v;
    cmd.setViewHandle(v);
    onReady(v);
    return () => {
      if (pending !== null) window.clearTimeout(pending);
      cmd.setViewHandle(null);
      onReady(null);
      v.dispose();
      vp.current = null;
    };
    // Mounted once: the viewport reads the store itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    vp.current?.setPeers(peers);
  }, [peers]);

  return <div className="viewport" ref={host} data-testid="viewport" />;
}

function StatusBar() {
  const notice = useEditor((s) => s.notice);
  const mode = useEditor((s) => s.mode);
  const tool = useEditor((s) => s.tool);
  const count = useEditor((s) => s.objects.size);
  const selected = useEditor((s) => s.selection.length);
  const [, force] = useState(0);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => force((n) => n + 1), 6_000);
    return () => window.clearTimeout(t);
  }, [notice]);
  const fresh = notice && Date.now() - notice.at < 6_000;
  const hint =
    mode === "edit"
      ? "Edit mode · click vertices (Shift adds) · E extrude · M merge · X delete · Tab back"
      : tool === "select"
        ? "Drag to box-select · Shift-click adds · middle-drag orbits · right-drag pans · scroll zooms"
        : "Click to select · drag the gizmo · left-drag orbits · right-drag pans · Ctrl snaps · Shift+A adds";
  return (
    <footer className="statusbar">
      <span className="status-hint">{hint}</span>
      <span className={`status-notice ${fresh && notice?.error ? "error" : ""}`} role="status" data-testid="notice">
        {fresh ? notice?.text : ""}
      </span>
      <span className="status-count">
        {selected ? `${selected} / ` : ""}
        {count} objects
      </span>
    </footer>
  );
}

function ArrayDialog({ onClose }: { onClose: () => void }) {
  const [count, setCount] = useState(3);
  const [step, setStep] = useState({ x: 1.5, y: 0, z: 0 });
  const vec = useMemo(() => new THREE.Vector3(step.x, step.y, step.z), [step]);
  return (
    <div className="dialog" role="dialog" aria-label="Array">
      <h3>Array</h3>
      <label>
        Copies
        <input type="number" min={1} max={100} value={count} onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
      </label>
      <div className="dialog-row">
        {(["x", "y", "z"] as const).map((a) => (
          <label key={a}>
            {a.toUpperCase()} step
            <input type="number" step={0.1} value={step[a]} onChange={(e) => setStep({ ...step, [a]: Number(e.target.value) || 0 })} />
          </label>
        ))}
      </div>
      <div className="dialog-row end">
        <button type="button" className="ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            cmd.arraySelection(count, vec);
            onClose();
          }}
        >
          Make {count} copies
        </button>
      </div>
    </div>
  );
}
