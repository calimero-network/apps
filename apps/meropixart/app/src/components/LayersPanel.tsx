import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { peekLayerCanvas } from "../store/layerCanvases";
import { BLEND_MODES, type BlendMode, type Layer, type LayerKind } from "../types";
import { Icon, type IconName } from "./ToolIcons";
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

const KIND_ICON: Record<LayerKind, IconName> = {
  raster: "raster", group: "group", text: "textLayer", adjustment: "adjustmentLayer", fill: "fillLayer",
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
                title={l.visible ? "Hide layer" : "Show layer"}
                aria-label={l.visible ? "Hide layer" : "Show layer"}
                onClick={(e) => { e.stopPropagation(); onUpdateMeta(l.id, { visible: !l.visible }); }}
              >
                <Icon name={l.visible ? "eye" : "eyeOff"} size={15} />
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
                  <span className={styles.kind} title={`${l.kind} layer`}><Icon name={KIND_ICON[l.kind]} size={14} /></span>
                  {l.name}
                  {l.maskBlobId && <span className={styles.maskTag} title="Has layer mask"><Icon name="mask" size={12} /></span>}
                </span>
              )}

              {editable && (
                <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
                  <button title={maskOn ? "Stop editing mask" : "Edit layer mask"}
                    aria-label={maskOn ? "Stop editing mask" : "Edit layer mask"}
                    className={maskOn ? styles.maskActive : ""}
                    onClick={() => setEditingMask(maskOn ? null : l.id)}><Icon name="mask" size={14} /></button>
                  <button title="Move layer up" aria-label="Move layer up" onClick={() => move(l.id, -1)}><Icon name="arrowUp" size={14} /></button>
                  <button title="Move layer down" aria-label="Move layer down" onClick={() => move(l.id, 1)}><Icon name="arrowDown" size={14} /></button>
                  <button title={l.locked ? "Unlock layer" : "Lock layer"}
                    aria-label={l.locked ? "Unlock layer" : "Lock layer"}
                    onClick={() => onUpdateMeta(l.id, { locked: !l.locked })}><Icon name={l.locked ? "lock" : "unlock"} size={14} /></button>
                  <button title="Delete layer" aria-label="Delete layer" className={styles.rowDel}
                    onClick={() => onDelete(l.id)}><Icon name="trash" size={14} /></button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {editable && (
        <div className={styles.toolbar}>
          <button title="New raster layer" aria-label="New raster layer" onClick={() => onAdd("raster")}><Icon name="raster" size={16} /></button>
          <button title="New text layer" aria-label="New text layer" onClick={() => onAdd("text")}><Icon name="textLayer" size={16} /></button>
          <button title="New fill layer" aria-label="New fill layer" onClick={() => onAdd("fill")}><Icon name="fillLayer" size={16} /></button>
          <button title="New group" aria-label="New group" onClick={() => onAdd("group")}><Icon name="group" size={16} /></button>
          <span className={styles.spacer} />
          <button title="Group selected layer" aria-label="Group selected layer" disabled={!sel} onClick={onGroupSelected}><Icon name="group" size={16} /></button>
          <button title="Add / remove layer mask" aria-label="Add or remove layer mask" disabled={!sel} onClick={() => sel && onToggleMask(sel.id)}><Icon name="mask" size={16} /></button>
          <button title="Duplicate layer" aria-label="Duplicate layer" disabled={!sel} onClick={() => sel && onDuplicate(sel.id)}><Icon name="duplicate" size={16} /></button>
          <button title="Delete layer" aria-label="Delete layer" className={styles.del} disabled={!sel} onClick={() => sel && onDelete(sel.id)}><Icon name="trash" size={16} /></button>
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
