import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { peekLayerCanvas } from "../store/layerCanvases";
import { BLEND_MODES, type BlendMode, type Layer, type LayerKind } from "../types";
import styles from "./LayersPanel.module.css";

interface Props {
  onAdd: (kind: LayerKind) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateMeta: (id: string, patch: Partial<Layer>) => void;
  onReorder: (orderedTopToBottom: string[]) => void;
  onGroupSelected: () => void;
  onToggleMask: (id: string) => void;
}

const KIND_GLYPH: Record<LayerKind, string> = {
  raster: "▦", group: "▣", text: "T", adjustment: "◐", fill: "■",
};

export default function LayersPanel({
  onAdd, onDelete, onDuplicate, onUpdateMeta, onReorder, onGroupSelected, onToggleMask,
}: Props) {
  const { layers, selectedLayerId, selectLayer, editingMaskOf, setEditingMask, canEdit } = useEditorStore();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const editable = canEdit();

  // top-to-bottom display = descending layerIndex
  const ordered = [...layers].sort((a, b) => b.layerIndex - a.layerIndex);
  const sel = layers.find((l) => l.id === selectedLayerId);

  const move = (id: string, dir: -1 | 1) => {
    const ids = ordered.map((l) => l.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); return; }
    const target = layers.find((l) => l.id === targetId);
    // dropping onto a group nests the dragged layer
    if (target?.kind === "group") {
      onUpdateMeta(dragId, { parentId: targetId });
      setDragId(null);
      return;
    }
    const ids = ordered.map((l) => l.id).filter((x) => x !== dragId);
    const ti = ids.indexOf(targetId);
    ids.splice(ti, 0, dragId);
    onReorder(ids);
    setDragId(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className="mp-label">Layers</span>
      </div>

      {sel && (
        <div className={styles.props}>
          <div className={styles.row}>
            <span className={styles.propLabel}>Blend</span>
            <select
              className={styles.select}
              value={sel.blendMode}
              disabled={!editable}
              onChange={(e) => onUpdateMeta(sel.id, { blendMode: e.target.value as BlendMode })}
            >
              {BLEND_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className={styles.row}>
            <span className={styles.propLabel}>Opacity</span>
            <input
              className="mp-range"
              type="range" min={0} max={100} value={sel.opacity}
              disabled={!editable}
              onChange={(e) => onUpdateMeta(sel.id, { opacity: Number(e.target.value) })}
            />
            <span className={styles.val}>{sel.opacity}</span>
          </div>
        </div>
      )}

      <div className={styles.list}>
        {ordered.length === 0 && <div className={styles.empty}>No layers yet</div>}
        {ordered.map((l) => {
          const isSel = l.id === selectedLayerId;
          const maskOn = editingMaskOf === l.id;
          return (
            <div
              key={l.id}
              className={`${styles.item} ${isSel ? styles.selected : ""} ${dragId === l.id ? styles.dragging : ""}`}
              style={{ paddingLeft: 8 + (l.parentId ? 16 : 0) }}
              draggable={editable}
              onDragStart={() => setDragId(l.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(l.id)}
              onClick={() => selectLayer(l.id)}
            >
              <button
                className={styles.eye}
                title={l.visible ? "Hide" : "Show"}
                onClick={(e) => { e.stopPropagation(); onUpdateMeta(l.id, { visible: !l.visible }); }}
              >
                {l.visible ? "👁" : "—"}
              </button>

              <Thumb layer={l} />

              {renaming === l.id ? (
                <input
                  className={styles.rename}
                  defaultValue={l.name}
                  autoFocus
                  onBlur={(e) => { onUpdateMeta(l.id, { name: e.target.value || l.name }); setRenaming(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span
                  className={styles.name}
                  onDoubleClick={(e) => { e.stopPropagation(); if (editable) setRenaming(l.id); }}
                >
                  <span className={styles.kind}>{KIND_GLYPH[l.kind]}</span>
                  {l.name}
                  {l.maskBlobId && <span className={styles.maskTag} title="Has mask">◳</span>}
                </span>
              )}

              {editable && (
                <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
                  <button title={maskOn ? "Stop editing mask" : "Edit mask"}
                    className={maskOn ? styles.maskActive : ""}
                    onClick={() => setEditingMask(maskOn ? null : l.id)}>◳</button>
                  <button title="Move up" onClick={() => move(l.id, -1)}>▲</button>
                  <button title="Move down" onClick={() => move(l.id, 1)}>▼</button>
                  <button title={l.locked ? "Unlock" : "Lock"}
                    onClick={() => onUpdateMeta(l.id, { locked: !l.locked })}>{l.locked ? "🔒" : "🔓"}</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editable && (
        <div className={styles.toolbar}>
          <button title="New raster layer" onClick={() => onAdd("raster")}>＋▦</button>
          <button title="New text layer" onClick={() => onAdd("text")}>＋T</button>
          <button title="New fill layer" onClick={() => onAdd("fill")}>＋■</button>
          <button title="New group" onClick={() => onAdd("group")}>＋▣</button>
          <span className={styles.spacer} />
          <button title="Group selected" disabled={!sel} onClick={onGroupSelected}>▣</button>
          <button title="Toggle mask" disabled={!sel} onClick={() => sel && onToggleMask(sel.id)}>◳</button>
          <button title="Duplicate" disabled={!sel} onClick={() => sel && onDuplicate(sel.id)}>⧉</button>
          <button title="Delete" className={styles.del} disabled={!sel} onClick={() => sel && onDelete(sel.id)}>🗑</button>
        </div>
      )}
    </div>
  );
}

function Thumb({ layer }: { layer: Layer }) {
  if (layer.kind === "fill") {
    return <span className={styles.thumb} style={{ background: layer.fill || "#000" }} />;
  }
  const c = peekLayerCanvas(layer.id);
  const url = c ? c.toDataURL() : "";
  return (
    <span className={`${styles.thumb} mp-checkerboard`}>
      {url && <img src={url} alt="" />}
    </span>
  );
}
