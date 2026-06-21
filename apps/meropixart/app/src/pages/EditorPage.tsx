import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { v4 as uuid } from "uuid";
import {
  rpcCall, adminGet, adminUploadBlob, adminGetBlob, joinContext,
} from "../api/rpc";
import { useSse } from "../hooks/useSse";
import { useToast } from "../contexts/ToastContext";
import { useEditorStore } from "../store/editorStore";
import {
  getLayerCanvas, peekLayerCanvas, getMaskCanvas, peekMaskCanvas,
  setLayerCanvas, dropLayerCanvas, dropMaskCanvas,
} from "../store/layerCanvases";
import {
  bytesToImage, canvasToPngBytes, createCanvas, ctx2d, applyCurves, parseCurves,
} from "../utils/raster";
import { composite } from "../utils/compositor";
import {
  NEUTRAL_ADJUSTMENTS, type Adjustments, type CursorState, type DocumentInfo,
  type Layer, type LayerKind, type Member, type Role,
} from "../types";
import Toolbar from "../components/Toolbar";
import CanvasStage from "../components/CanvasStage";
import LayersPanel from "../components/LayersPanel";
import AdjustmentsPanel from "../components/AdjustmentsPanel";
import TopBar from "../components/TopBar";
import CursorsOverlay from "../components/CursorsOverlay";
import InviteModal from "../components/InviteModal";
import SettingsModal from "../components/SettingsModal";
import UsernameModal from "../components/UsernameModal";
import styles from "./EditorPage.module.css";

const ts = () => Date.now();

export default function EditorPage() {
  const { teamId, projectId } = useParams();
  const ctxId = projectId ?? "";
  const navigate = useNavigate();
  const { showToast } = useToast();

  const {
    doc, layers, selectedLayerId, editingMaskOf,
    setDoc, setLayers, upsertLayer, removeLayer, selectLayer, setEditingMask,
    setRole, setZoom, setPan, bumpRender, canEdit, clearHistory,
  } = useEditorStore();

  const myId = useRef<string>("");
  const loadedBlobs = useRef<Set<string>>(new Set());
  const lastCursor = useRef(0);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const adjTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [cursors, setCursors] = useState<CursorState[]>([]);
  const [subgroupId, setSubgroupId] = useState("");
  const [needName, setNeedName] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState("");

  // ── Identity ────────────────────────────────────────────────────────────
  const resolveIdentity = useCallback(async (): Promise<string> => {
    try {
      const owned = await adminGet<string[] | { identities?: string[] }>(
        `/contexts/${ctxId}/identities-owned`,
      );
      const arr = Array.isArray(owned) ? owned : owned?.identities ?? [];
      if (arr[0]) return arr[0];
    } catch { /* not joined yet */ }
    try {
      const r = await joinContext(ctxId);
      if (r?.memberPublicKey) return r.memberPublicKey;
    } catch { /* ignore */ }
    const key = `mp-identity-${ctxId}`;
    let id = localStorage.getItem(key);
    if (!id) { id = uuid(); localStorage.setItem(key, id); }
    return id;
  }, [ctxId]);

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadBlobs = useCallback(async (ls: Layer[]) => {
    for (const l of ls) {
      if (l.blobId && !loadedBlobs.current.has(l.blobId)) {
        loadedBlobs.current.add(l.blobId);
        try {
          const buf = await adminGetBlob(l.blobId, ctxId);
          const img = await bytesToImage(buf);
          const c = getLayerCanvas(l.id, l.width || img.width, l.height || img.height);
          const cx = ctx2d(c);
          cx.clearRect(0, 0, c.width, c.height);
          cx.drawImage(img, 0, 0);
          setLayerCanvas(l.id, c);
          bumpRender();
        } catch { loadedBlobs.current.delete(l.blobId); }
      }
      if (l.maskBlobId && !loadedBlobs.current.has(l.maskBlobId)) {
        loadedBlobs.current.add(l.maskBlobId);
        try {
          const buf = await adminGetBlob(l.maskBlobId, ctxId);
          const img = await bytesToImage(buf);
          const c = getMaskCanvas(l.id, l.width || img.width, l.height || img.height);
          const cx = ctx2d(c);
          cx.clearRect(0, 0, c.width, c.height);
          cx.drawImage(img, 0, 0);
          bumpRender();
        } catch { loadedBlobs.current.delete(l.maskBlobId); }
      }
    }
  }, [ctxId, bumpRender]);

  const refetch = useCallback(async () => {
    try {
      const [d, ls, ms, cs] = await Promise.all([
        rpcCall<DocumentInfo>(ctxId, "get_document", {}),
        rpcCall<Layer[]>(ctxId, "get_layers", {}),
        rpcCall<Member[]>(ctxId, "get_members", {}),
        rpcCall<CursorState[]>(ctxId, "get_cursors", {}),
      ]);
      if (d) setDoc(d);
      if (Array.isArray(ls)) { setLayers(ls); loadBlobs(ls); }
      if (Array.isArray(ms)) setMembers(ms);
      if (Array.isArray(cs)) setCursors(cs);
    } catch { /* transient */ }
  }, [ctxId, setDoc, setLayers, loadBlobs]);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ctxId) { setFatal("No project specified."); return; }
    let cancelled = false;
    (async () => {
      myId.current = await resolveIdentity();
      // resolve the subgroup id (for SettingsModal role queries)
      try {
        const ctxInfo = await adminGet<{ groupId?: string; subgroupId?: string }>(`/contexts/${ctxId}`);
        if (ctxInfo?.subgroupId || ctxInfo?.groupId) setSubgroupId(ctxInfo.subgroupId ?? ctxInfo.groupId ?? "");
      } catch { /* optional */ }

      try {
        const d = await rpcCall<DocumentInfo>(ctxId, "get_document", {});
        if (cancelled) return;
        if (d) {
          setDoc(d);
          // fit-to-screen-ish default
          setZoom(1);
          setPan(48, 48);
        }
      } catch {
        if (!cancelled) setFatal("Could not load the project. The node may still be syncing — try reopening.");
        return;
      }

      const ls = await rpcCall<Layer[]>(ctxId, "get_layers", {}).catch(() => [] as Layer[]);
      if (!cancelled && Array.isArray(ls)) { setLayers(ls); loadBlobs(ls); if (ls[0]) selectLayer(ls[ls.length - 1].id); }

      const role = await rpcCall<Role>(ctxId, "my_role", {}).catch(() => "viewer" as Role);
      if (!cancelled) setRole(role);

      const ms = await rpcCall<Member[]>(ctxId, "get_members", {}).catch(() => [] as Member[]);
      if (!cancelled && Array.isArray(ms)) {
        setMembers(ms);
        if (!ms.some((m) => m.id === myId.current)) setNeedName(true);
      }

      const cs = await rpcCall<CursorState[]>(ctxId, "get_cursors", {}).catch(() => [] as CursorState[]);
      if (!cancelled && Array.isArray(cs)) setCursors(cs);

      if (!cancelled) { setReady(true); clearHistory(); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxId]);

  // ── SSE: debounced refetch on any contract event ──────────────────────────
  useSse(ctxId || null, () => {
    if (refetchTimer.current) clearTimeout(refetchTimer.current);
    refetchTimer.current = setTimeout(() => { refetch(); }, 300);
  });

  // ── Join / username ───────────────────────────────────────────────────────
  const handleJoin = useCallback(async (username: string) => {
    try {
      await rpcCall(ctxId, "join", { username, avatar: null, timestamp: ts() });
      setNeedName(false);
      localStorage.setItem("mp-username", username);
      const role = await rpcCall<Role>(ctxId, "my_role", {}).catch(() => "viewer" as Role);
      setRole(role);
      refetch();
    } catch (e) {
      showToast(errMsg(e), "error");
    }
  }, [ctxId, setRole, refetch, showToast]);

  // ── Pixel commit (raster) ───────────────────────────────────────────────
  const commitPixels = useCallback(async (layerId: string) => {
    const c = peekLayerCanvas(layerId);
    if (!c) return;
    setSaving(true);
    try {
      const bytes = await canvasToPngBytes(c);
      const { blobId } = await adminUploadBlob(bytes, ctxId);
      if (!blobId) throw new Error("blob upload failed");
      loadedBlobs.current.add(blobId);
      const now = ts();
      await rpcCall(ctxId, "update_layer_content", {
        id: layerId, blob_id: blobId, width: c.width, height: c.height, updated_at: now,
      });
      const l = useEditorStore.getState().layers.find((x) => x.id === layerId);
      if (l) upsertLayer({ ...l, blobId, width: c.width, height: c.height, updatedAt: now });
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally {
      setSaving(false);
    }
  }, [ctxId, upsertLayer, showToast]);

  const commitMaskPixels = useCallback(async (layerId: string) => {
    const c = peekMaskCanvas(layerId);
    if (!c) return;
    setSaving(true);
    try {
      const bytes = await canvasToPngBytes(c);
      const { blobId } = await adminUploadBlob(bytes, ctxId);
      if (!blobId) throw new Error("mask upload failed");
      loadedBlobs.current.add(blobId);
      const now = ts();
      await rpcCall(ctxId, "update_layer_mask", { id: layerId, mask_blob_id: blobId, updated_at: now });
      const l = useEditorStore.getState().layers.find((x) => x.id === layerId);
      if (l) upsertLayer({ ...l, maskBlobId: blobId, updatedAt: now });
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally { setSaving(false); }
  }, [ctxId, upsertLayer, showToast]);

  // ── Metadata commit (transform / props) ───────────────────────────────────
  const commitMeta = useCallback(async (layerId: string, patch: Partial<Layer>) => {
    const now = ts();
    const args: Record<string, unknown> = {
      id: layerId,
      name: patch.name ?? null,
      visible: patch.visible ?? null,
      locked: patch.locked ?? null,
      opacity: patch.opacity ?? null,
      blend_mode: patch.blendMode ?? null,
      x: patch.x ?? null,
      y: patch.y ?? null,
      width: patch.width ?? null,
      height: patch.height ?? null,
      rotation: patch.rotation ?? null,
      scale_x: patch.scaleX ?? null,
      scale_y: patch.scaleY ?? null,
      fill: patch.fill ?? null,
      updated_at: now,
    };
    try {
      await rpcCall(ctxId, "update_layer", args);
    } catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, showToast]);

  const onUpdateMeta = useCallback((id: string, patch: Partial<Layer>) => {
    const l = useEditorStore.getState().layers.find((x) => x.id === id);
    if (!l) return;
    const next = { ...l, ...patch, updatedAt: ts() };
    upsertLayer(next);
    bumpRender();
    if (patch.parentId !== undefined) {
      rpcCall(ctxId, "move_layer", {
        id, parent_id: patch.parentId ?? null, layer_index: next.layerIndex, updated_at: next.updatedAt,
      }).catch((e) => showToast(errMsg(e), "error"));
    } else {
      commitMeta(id, patch);
    }
  }, [ctxId, upsertLayer, bumpRender, commitMeta, showToast]);

  // ── Layer lifecycle ────────────────────────────────────────────────────────
  const nextIndex = () => Math.max(0, ...useEditorStore.getState().layers.map((l) => l.layerIndex)) + 1;

  const makeLayer = (kind: LayerKind): Layer => {
    const id = uuid();
    const w = kind === "text" ? 520 : doc?.width ?? 1280;
    const h = kind === "text" ? 160 : doc?.height ?? 720;
    return {
      id,
      name: kind === "raster" ? "Layer" : kind === "text" ? "Text" : kind === "fill" ? "Fill" : kind === "group" ? "Group" : "Adjustment",
      kind,
      parentId: null,
      layerIndex: nextIndex(),
      visible: true,
      locked: false,
      opacity: 100,
      blendMode: "normal",
      x: 0, y: 0, width: w, height: h, rotation: 0, scaleX: 100, scaleY: 100,
      blobId: "",
      maskBlobId: null,
      fill: kind === "fill" ? useEditorStore.getState().primaryColor : "",
      adjustments: { ...NEUTRAL_ADJUSTMENTS },
      text: kind === "text"
        ? { content: "Double-click to edit", fontFamily: "Inter", fontSize: 72, color: useEditorStore.getState().primaryColor, bold: true, italic: false }
        : null,
      createdBy: myId.current,
      createdAt: ts(),
      updatedAt: ts(),
    };
  };

  const onAdd = useCallback(async (kind: LayerKind) => {
    if (!canEdit() || !doc) return;
    const layer = makeLayer(kind);
    if (kind === "raster") getLayerCanvas(layer.id, layer.width, layer.height); // blank transparent
    upsertLayer(layer);
    selectLayer(layer.id);
    bumpRender();
    try { await rpcCall(ctxId, "add_layer", { layer }); }
    catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, doc, canEdit, upsertLayer, selectLayer, bumpRender, showToast]);

  const onDelete = useCallback(async (id: string) => {
    removeLayer(id);
    dropLayerCanvas(id);
    dropMaskCanvas(id);
    bumpRender();
    try { await rpcCall(ctxId, "delete_layer", { id }); }
    catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, removeLayer, bumpRender, showToast]);

  const onDuplicate = useCallback(async (id: string) => {
    const src = useEditorStore.getState().layers.find((l) => l.id === id);
    if (!src || !canEdit()) return;
    const copy: Layer = { ...src, id: uuid(), name: `${src.name} copy`, layerIndex: nextIndex(), blobId: "", maskBlobId: null, updatedAt: ts(), createdAt: ts() };
    const srcCanvas = peekLayerCanvas(id);
    if (srcCanvas) {
      const c = getLayerCanvas(copy.id, srcCanvas.width, srcCanvas.height);
      ctx2d(c).drawImage(srcCanvas, 0, 0);
    }
    upsertLayer(copy);
    selectLayer(copy.id);
    bumpRender();
    try {
      await rpcCall(ctxId, "add_layer", { layer: copy });
      if (srcCanvas) await commitPixels(copy.id);
    } catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, canEdit, upsertLayer, selectLayer, bumpRender, commitPixels, showToast]);

  const onReorder = useCallback(async (topToBottom: string[]) => {
    // top of panel = highest index
    const n = topToBottom.length;
    const order: Array<[string, number]> = topToBottom.map((id, i) => [id, n - 1 - i]);
    const now = ts();
    const cur = useEditorStore.getState().layers;
    setLayers(cur.map((l) => {
      const found = order.find((o) => o[0] === l.id);
      return found ? { ...l, layerIndex: found[1], updatedAt: now } : l;
    }));
    bumpRender();
    try { await rpcCall(ctxId, "reorder_layers", { order, updated_at: now }); }
    catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, setLayers, bumpRender, showToast]);

  const onGroupSelected = useCallback(async () => {
    const sel = useEditorStore.getState().selectedLayer();
    if (!sel || !canEdit()) return;
    const group = makeLayer("group");
    group.name = "Group";
    group.layerIndex = sel.layerIndex; // sit near the grouped layer
    upsertLayer(group);
    try {
      await rpcCall(ctxId, "add_layer", { layer: group });
      onUpdateMeta(sel.id, { parentId: group.id });
    } catch (e) { showToast(errMsg(e), "error"); }
  }, [ctxId, canEdit, upsertLayer, onUpdateMeta, showToast]);

  const onToggleMask = useCallback(async (id: string) => {
    const l = useEditorStore.getState().layers.find((x) => x.id === id);
    if (!l || !canEdit()) return;
    if (l.maskBlobId) {
      // remove mask
      dropMaskCanvas(id);
      upsertLayer({ ...l, maskBlobId: null, updatedAt: ts() });
      setEditingMask(null);
      bumpRender();
      try { await rpcCall(ctxId, "update_layer_mask", { id, mask_blob_id: null, updated_at: ts() }); }
      catch (e) { showToast(errMsg(e), "error"); }
    } else {
      getMaskCanvas(id, l.width, l.height); // white = fully visible
      setEditingMask(id);
      await commitMaskPixels(id);
      bumpRender();
    }
  }, [ctxId, canEdit, upsertLayer, setEditingMask, bumpRender, commitMaskPixels, showToast]);

  // ── Adjustments ─────────────────────────────────────────────────────────
  const onAdjust = useCallback((patch: Partial<Adjustments>) => {
    const sel = useEditorStore.getState().selectedLayer();
    if (!sel || !canEdit()) return;
    const adjustments = { ...sel.adjustments, ...patch };
    upsertLayer({ ...sel, adjustments, updatedAt: ts() });
    bumpRender();
    if (adjTimer.current) clearTimeout(adjTimer.current);
    const id = sel.id;
    adjTimer.current = setTimeout(() => {
      rpcCall(ctxId, "update_adjustments", {
        id,
        brightness: adjustments.brightness,
        contrast: adjustments.contrast,
        saturation: adjustments.saturation,
        hue: adjustments.hue,
        exposure: adjustments.exposure,
        blur: adjustments.blur,
        invert: adjustments.invert,
        curves: adjustments.curves ?? "",
        updated_at: ts(),
      }).catch((e) => showToast(errMsg(e), "error"));
    }, 350);
  }, [ctxId, canEdit, upsertLayer, bumpRender, showToast]);

  const onApplyCurves = useCallback(async (curvesJson: string) => {
    const sel = useEditorStore.getState().selectedLayer();
    if (!sel || !canEdit()) return;
    const curves = parseCurves(curvesJson);
    const c = peekLayerCanvas(sel.id);
    if (curves && c && (sel.kind === "raster" || sel.kind === "fill")) {
      const baked = applyCurves(c, curves);
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(baked, 0, 0);
      bumpRender();
      await commitPixels(sel.id);
    }
    // record the curve on the layer too
    rpcCall(ctxId, "update_adjustments", {
      id: sel.id,
      brightness: sel.adjustments.brightness, contrast: sel.adjustments.contrast,
      saturation: sel.adjustments.saturation, hue: sel.adjustments.hue,
      exposure: sel.adjustments.exposure, blur: sel.adjustments.blur,
      invert: sel.adjustments.invert, curves: curvesJson, updated_at: ts(),
    }).catch(() => {});
  }, [ctxId, canEdit, bumpRender, commitPixels]);

  // ── Image import ───────────────────────────────────────────────────────────
  const onImportImage = useCallback(async (file: File) => {
    if (!canEdit() || !doc) { showToast("You need editor access to add images.", "error"); return; }
    setSaving(true);
    try {
      const buf = await file.arrayBuffer();
      const img = await bytesToImage(buf, file.type || "image/png");
      const layer = makeLayer("raster");
      layer.name = file.name.replace(/\.[^.]+$/, "") || "Image";
      layer.width = img.width;
      layer.height = img.height;
      layer.x = Math.round((doc.width - img.width) / 2);
      layer.y = Math.round((doc.height - img.height) / 2);
      const c = getLayerCanvas(layer.id, img.width, img.height);
      ctx2d(c).drawImage(img, 0, 0);
      upsertLayer(layer);
      selectLayer(layer.id);
      bumpRender();
      await rpcCall(ctxId, "add_layer", { layer });
      await commitPixels(layer.id);
    } catch (e) {
      showToast(errMsg(e), "error");
    } finally { setSaving(false); }
  }, [ctxId, doc, canEdit, upsertLayer, selectLayer, bumpRender, commitPixels, showToast]);

  // ── Export ───────────────────────────────────────────────────────────────
  const onExport = useCallback((format: "png" | "jpeg") => {
    if (!doc) return;
    const bg = format === "jpeg" ? (doc.background && doc.background !== "#00000000" ? doc.background : "#ffffff") : doc.background;
    let flat = composite(useEditorStore.getState().layers, doc.width, doc.height, { background: bg });
    if (format === "jpeg") {
      const opaque = createCanvas(flat.width, flat.height);
      const oc = ctx2d(opaque);
      oc.fillStyle = "#ffffff";
      oc.fillRect(0, 0, opaque.width, opaque.height);
      oc.drawImage(flat, 0, 0);
      flat = opaque;
    }
    const url = flat.toDataURL(format === "png" ? "image/png" : "image/jpeg", 0.92);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${doc.name || "meropixart"}.${format === "png" ? "png" : "jpg"}`;
    a.click();
  }, [doc]);

  // ── Cursor broadcast ───────────────────────────────────────────────────────
  const onCursorMove = useCallback((x: number, y: number) => {
    const now = Date.now();
    if (now - lastCursor.current < 1500) return;
    lastCursor.current = now;
    rpcCall(ctxId, "update_cursor", { x: Math.round(x), y: Math.round(y), updated_at: now }).catch(() => {});
  }, [ctxId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useEditorStore.getState().redo();
        else useEditorStore.getState().undo();
      }
      if (!mod) {
        const map: Record<string, string> = {
          v: "move", b: "brush", e: "eraser", g: "bucket", i: "eyedropper",
          t: "text", m: "marquee", h: "hand", c: "crop",
        };
        if (map[e.key]) useEditorStore.getState().setTool(map[e.key] as never);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Remote cursors transformed to screen space ─────────────────────────────
  const screenCursors = useMemo(() => {
    const { zoom, panX, panY } = useEditorStore.getState();
    return cursors.map((c) => ({ ...c, x: c.x * zoom + panX, y: c.y * zoom + panY }));
    // re-derive when cursors or view changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursors, useEditorStore((s) => s.zoom), useEditorStore((s) => s.panX), useEditorStore((s) => s.panY)]);

  const selLayer = layers.find((l) => l.id === selectedLayerId);
  const role = useEditorStore((s) => s.myRole);

  if (fatal) {
    return (
      <div className={styles.fatal}>
        <p>{fatal}</p>
        <button className="mp-btn mp-btn--primary" onClick={() => navigate(`/teams/${teamId}/projects`)}>Back to projects</button>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <TopBar
        docName={doc?.name ?? ""}
        members={members}
        role={role}
        saving={saving}
        onBack={() => navigate(`/teams/${teamId}/projects`)}
        onImportImage={onImportImage}
        onExport={onExport}
        onOpenInvite={() => setShowInvite(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className={styles.body}>
        <Toolbar />
        <CanvasStage
          commitPixels={commitPixels}
          commitMaskPixels={commitMaskPixels}
          commitMeta={commitMeta}
          onCursorMove={onCursorMove}
          overlay={<CursorsOverlay cursors={screenCursors} myIdentity={myId.current} members={members} />}
        />
        <div className={styles.rightDock}>
          <AdjustmentsPanel
            layer={selLayer}
            onAdjust={onAdjust}
            onApplyCurves={onApplyCurves}
            disabled={!canEdit()}
          />
          <LayersPanel
            onAdd={onAdd}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onUpdateMeta={onUpdateMeta}
            onReorder={onReorder}
            onGroupSelected={onGroupSelected}
            onToggleMask={onToggleMask}
          />
        </div>
      </div>

      {editingMaskOf && (
        <div className={styles.maskBanner}>
          Editing mask — paint black to hide, white to reveal.
          <button onClick={() => setEditingMask(null)}>Done</button>
        </div>
      )}

      {!ready && !fatal && <div className={styles.loading}>Loading project…</div>}
      {needName && <UsernameModal onSubmit={handleJoin} initialValue={localStorage.getItem("mp-username") ?? ""} />}
      {showInvite && teamId && <InviteModal teamId={teamId} onClose={() => setShowInvite(false)} />}
      {showSettings && (
        <SettingsModal
          type="project"
          id={ctxId}
          groupId={subgroupId}
          name={doc?.name ?? "Project"}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
