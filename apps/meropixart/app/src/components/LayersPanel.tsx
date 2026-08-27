import { useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { peekLayerCanvas } from "../store/layerCanvases";
import {
  buildTree, contentCount, isDescendantOf, visibleRows, type TreeNode,
} from "../utils/layerTree";
import { BLEND_MODES, type BlendMode, type Layer, type LayerKind, type TextProps } from "../types";
import { Icon, type IconName } from "./ToolIcons";
import ColorPicker from "./ColorPicker";
import styles from "./LayersPanel.module.css";

interface Props {
  onAdd: (kind: LayerKind) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onUpdateMeta: (id: string, patch: Partial<Layer>) => void;
  onUpdateText: (id: string, patch: Partial<TextProps>) => void;
  onReorder: (orderedTopToBottom: string[]) => void;
  /** Wrap the current selection in a new folder. */
  onGroupSelected: () => void;
  /** Dissolve a folder, lifting its contents to the folder's own parent. */
  onUngroup: (id: string) => void;
  onToggleMask: (id: string) => void;
}

const KIND_ICON: Record<LayerKind, IconName> = {
  raster: "raster", group: "folder", text: "textLayer", adjustment: "adjustmentLayer", fill: "fillLayer",
};

/** One indent step per nesting level, in px. */
const INDENT = 14;

export default function LayersPanel({
  onAdd, onDelete, onDuplicate, onUpdateMeta, onUpdateText, onReorder,
  onGroupSelected, onUngroup, onToggleMask,
}: Props) {
  const {
    layers, selectedLayerId, selectedLayerIds, selectLayer, setSelectedLayers,
    toggleLayerSelection, editingMaskOf, setEditingMask, canEdit, upsertLayer, bumpRender,
    panelCollapsed, togglePanelCollapsed, collapsedGroups, toggleGroupCollapsed,
    setAllGroupsCollapsed,
  } = useEditorStore();
  const collapsed = panelCollapsed.layers;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Row (or the root strip) a drag is currently over, for the drop indicator. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const draftColor = useRef<string>("");
  const editable = canEdit();

  const tree = buildTree(layers);
  // Every row in display order, collapsed subtrees included: reordering must
  // renumber the layers you cannot see too, or collapsing a folder would
  // silently reshuffle its contents' paint order.
  const allRows = visibleRows(tree, {});
  const rows = visibleRows(tree, collapsedGroups);
  const sel = layers.find((l) => l.id === selectedLayerId);
  const groups = layers.filter((l) => l.kind === "group");
  const anyExpanded = groups.some((g) => !collapsedGroups[g.id]);
  // The folders a "Group selected" would wrap: ignore the contents that travel
  // along with a selected folder, so the button label counts real subjects.
  const selectionSize = selectedLayerIds.length;

  const move = (id: string, dir: -1 | 1) => {
    const ids = allRows.map((n) => n.layer.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    onReorder(ids);
  };

  // Shift = range-select (panel order), Cmd/Ctrl = toggle, plain = single.
  // A folder row resolves to the folder plus its contents (in the store).
  const onRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && selectedLayerId) {
      const ids = rows.map((n) => n.layer.id);
      const a = ids.indexOf(selectedLayerId);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        const range = ids.slice(lo, hi + 1).filter((x) => x !== id);
        setSelectedLayers([...range, id]); // keep the clicked layer as primary
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) { toggleLayerSelection(id); return; }
    selectLayer(id);
  };

  /** Can `dragId` be dropped onto `targetId` without closing a cycle? */
  const canDropInto = (targetId: string): boolean => {
    if (!dragId || dragId === targetId) return false;
    const target = layers.find((l) => l.id === targetId);
    if (target?.kind !== "group") return false;
    return !isDescendantOf(layers, targetId, dragId);
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setDropOn(null); return; }
    // Dropping onto a folder nests the dragged layer inside it. Dropping a
    // folder into its own descendant is refused rather than silently ignored
    // further down the stack.
    const target = layers.find((l) => l.id === targetId);
    if (target?.kind === "group") {
      if (canDropInto(targetId)) {
        onUpdateMeta(dragId, { parentId: targetId });
        useEditorStore.getState().setGroupCollapsed(targetId, false); // reveal the drop
      }
      setDragId(null);
      setDropOn(null);
      return;
    }
    // Dropping onto a plain layer reorders: take the target's slot, and join the
    // folder the target lives in so the row lands where it was dropped.
    const dragged = layers.find((l) => l.id === dragId);
    if (dragged && target && (dragged.parentId ?? null) !== (target.parentId ?? null)) {
      onUpdateMeta(dragId, { parentId: target.parentId ?? null });
    }
    const ids = allRows.map((n) => n.layer.id).filter((x) => x !== dragId);
    const ti = ids.indexOf(targetId);
    ids.splice(ti, 0, dragId);
    onReorder(ids);
    setDragId(null);
    setDropOn(null);
  };

  /** Drop on the strip below the list = leave every folder (move to top level). */
  const onDropRoot = () => {
    if (dragId) {
      const dragged = layers.find((l) => l.id === dragId);
      if (dragged?.parentId) onUpdateMeta(dragId, { parentId: null });
    }
    setDragId(null);
    setDropOn(null);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <button className="mp-collapse" onClick={() => togglePanelCollapsed("layers")}
          aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} Layers`}>
          <span className="mp-chev">{collapsed ? "▸" : "▾"}</span>
          <span className="mp-label">Layers</span>
        </button>
        <div className={styles.headerRight}>
          {selectionSize > 1 && (
            <span className={styles.selCount}>{selectionSize} selected</span>
          )}
          {groups.length > 0 && !collapsed && (
            <button
              type="button"
              className={styles.headerBtn}
              title={anyExpanded ? "Collapse all folders" : "Expand all folders"}
              aria-label={anyExpanded ? "Collapse all folders" : "Expand all folders"}
              data-testid="collapse-all-groups"
              onClick={() => setAllGroupsCollapsed(anyExpanded)}
            >
              {anyExpanded ? "⌄⌄" : "⌃⌃"}
            </button>
          )}
        </div>
      </div>
      {!collapsed && (<>

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
              aria-label="Layer opacity"
              data-testid="layer-opacity"
              disabled={!editable}
              onChange={(e) => onUpdateMeta(sel.id, { opacity: Number(e.target.value) })}
            />
            <span className={styles.val}>{sel.opacity}</span>
          </div>
          {(sel.kind === "fill" || sel.kind === "text") && (
            <div className={styles.row}>
              <span className={styles.propLabel}>Color</span>
              <button
                type="button"
                className={styles.colorSwatch}
                style={{ backgroundColor: layerColor(sel) }}
                disabled={!editable}
                title="Edit color"
                aria-label="Edit layer color"
                data-testid="layer-color-swatch"
                onClick={() => { draftColor.current = layerColor(sel); setColorOpen(true); }}
              />
              <span className={styles.colorHex}>{layerColor(sel)}</span>
            </div>
          )}
          {sel.kind === "group" && (
            <div className={styles.row}>
              <span className={styles.propLabel}>Folder</span>
              <span className={styles.groupMeta} data-testid="group-content-count">
                {contentCount(layers, sel.id)} layer{contentCount(layers, sel.id) === 1 ? "" : "s"} inside
              </span>
              {editable && (
                <button
                  type="button"
                  className={styles.ungroupBtn}
                  data-testid="ungroup-selected"
                  onClick={() => onUngroup(sel.id)}
                >
                  Ungroup
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {colorOpen && sel && (
        <ColorPicker
          title={sel.kind === "fill" ? "Fill color" : "Text color"}
          value={layerColor(sel)}
          onChange={(hex) => {
            // Live preview without an RPC per change; persist once on close.
            draftColor.current = hex;
            if (sel.kind === "fill") upsertLayer({ ...sel, fill: hex });
            else if (sel.text) upsertLayer({ ...sel, text: { ...sel.text, color: hex } });
            bumpRender();
          }}
          onClose={() => {
            setColorOpen(false);
            if (sel.kind === "fill") onUpdateMeta(sel.id, { fill: draftColor.current });
            else if (sel.kind === "text") onUpdateText(sel.id, { color: draftColor.current });
          }}
        />
      )}

      <div className={styles.list} data-testid="layers-list">
        {rows.length === 0 && <div className={styles.empty}>No layers yet</div>}
        {rows.map((node) => (
          <LayerRow
            key={node.layer.id}
            node={node}
            layers={layers}
            editable={editable}
            selected={selectedLayerIds.includes(node.layer.id)}
            isPrimary={node.layer.id === selectedLayerId}
            multi={selectedLayerIds.length > 1}
            collapsedGroups={collapsedGroups}
            dragId={dragId}
            dropOn={dropOn}
            maskOn={editingMaskOf === node.layer.id}
            renaming={renaming === node.layer.id}
            onStartRename={() => setRenaming(node.layer.id)}
            onEndRename={(name) => {
              if (name) onUpdateMeta(node.layer.id, { name });
              setRenaming(null);
            }}
            onClick={(e) => onRowClick(e, node.layer.id)}
            onToggleCollapse={() => toggleGroupCollapsed(node.layer.id)}
            onDragStart={() => setDragId(node.layer.id)}
            onDragEnd={() => { setDragId(null); setDropOn(null); }}
            onDragOverRow={() => setDropOn(node.layer.id)}
            onDrop={() => onDrop(node.layer.id)}
            onUpdateMeta={onUpdateMeta}
            onSetEditingMask={setEditingMask}
            onMove={move}
            onDelete={onDelete}
          />
        ))}

        {/* Root drop strip — the way back out of a folder without a menu. */}
        {editable && dragId && (
          <div
            className={`${styles.rootDrop} ${dropOn === "__root__" ? styles.dropTarget : ""}`}
            data-testid="root-drop-zone"
            onDragOver={(e) => { e.preventDefault(); setDropOn("__root__"); }}
            onDragLeave={() => setDropOn(null)}
            onDrop={onDropRoot}
          >
            Drop here to move out of its folder
          </div>
        )}
      </div>

      {editable && (
        <div className={styles.toolbar}>
          <button title="New raster layer" aria-label="New raster layer" onClick={() => onAdd("raster")}><Icon name="raster" size={16} /></button>
          <button title="New text layer" aria-label="New text layer" onClick={() => onAdd("text")}><Icon name="textLayer" size={16} /></button>
          <button title="New fill layer" aria-label="New fill layer" onClick={() => onAdd("fill")}><Icon name="fillLayer" size={16} /></button>
          <button title="New folder" aria-label="New folder" onClick={() => onAdd("group")}><Icon name="folder" size={16} /></button>
          <span className={styles.spacer} />
          <button
            title="Group selection into a folder"
            aria-label="Group selection into a folder"
            data-testid="group-selected"
            disabled={!sel}
            onClick={onGroupSelected}
          ><Icon name="group" size={16} /></button>
          <button
            title="Ungroup folder"
            aria-label="Ungroup folder"
            data-testid="ungroup-folder"
            disabled={sel?.kind !== "group"}
            onClick={() => sel && onUngroup(sel.id)}
          ><Icon name="ungroup" size={16} /></button>
          <button title="Add / remove layer mask" aria-label="Add or remove layer mask" disabled={!sel} onClick={() => sel && onToggleMask(sel.id)}><Icon name="mask" size={16} /></button>
          <button title="Duplicate layer" aria-label="Duplicate layer" disabled={!sel} onClick={() => sel && onDuplicate(sel.id)}><Icon name="duplicate" size={16} /></button>
          <button title="Delete layer" aria-label="Delete layer" className={styles.del} disabled={!sel} onClick={() => sel && onDelete(sel.id)}><Icon name="trash" size={16} /></button>
        </div>
      )}
      </>)}
    </div>
  );
}

interface RowProps {
  node: TreeNode;
  layers: Layer[];
  editable: boolean;
  selected: boolean;
  isPrimary: boolean;
  multi: boolean;
  collapsedGroups: Record<string, boolean>;
  dragId: string | null;
  dropOn: string | null;
  maskOn: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onEndRename: (name: string) => void;
  onClick: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOverRow: () => void;
  onDrop: () => void;
  onUpdateMeta: (id: string, patch: Partial<Layer>) => void;
  onSetEditingMask: (id: string | null) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onDelete: (id: string) => void;
}

function LayerRow({
  node, layers, editable, selected, isPrimary, multi, collapsedGroups,
  dragId, dropOn, maskOn, renaming, onStartRename, onEndRename, onClick,
  onToggleCollapse, onDragStart, onDragEnd, onDragOverRow, onDrop,
  onUpdateMeta, onSetEditingMask, onMove, onDelete,
}: RowProps) {
  const l = node.layer;
  const isGroup = l.kind === "group";
  const isCollapsed = !!collapsedGroups[l.id];
  const count = isGroup ? contentCount(layers, l.id) : 0;
  const isDropTarget = dropOn === l.id && dragId !== null && dragId !== l.id;
  // Highlight a folder as a nesting target only when the drop is actually legal.
  const nestable = isDropTarget && isGroup && dragId !== null
    && !isDescendantOf(layers, l.id, dragId);

  return (
    <div
      className={[
        styles.item,
        isGroup ? styles.groupItem : "",
        selected ? styles.selected : "",
        isPrimary && multi ? styles.primary : "",
        dragId === l.id ? styles.dragging : "",
        nestable ? styles.nestTarget : isDropTarget ? styles.dropTarget : "",
      ].filter(Boolean).join(" ")}
      style={{ paddingLeft: 8 + node.depth * INDENT }}
      draggable={editable}
      data-testid={`layer-row-${l.id}`}
      data-depth={node.depth}
      data-kind={l.kind}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOverRow(); }}
      onDrop={onDrop}
      onClick={onClick}
    >
      {/* Folder twirl — the disclosure control, mirroring the dock's chevrons. */}
      {isGroup ? (
        <button
          className={styles.twirl}
          title={isCollapsed ? "Expand folder" : "Collapse folder"}
          aria-label={`${isCollapsed ? "Expand" : "Collapse"} folder ${l.name}`}
          aria-expanded={!isCollapsed}
          data-testid={`group-twirl-${l.id}`}
          onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
        >
          {isCollapsed ? "▸" : "▾"}
        </button>
      ) : (
        <span className={styles.twirlSpacer} />
      )}

      <button
        className={styles.eye}
        title={l.visible ? "Hide layer" : "Show layer"}
        aria-label={l.visible ? "Hide layer" : "Show layer"}
        onClick={(e) => { e.stopPropagation(); onUpdateMeta(l.id, { visible: !l.visible }); }}
      >
        <Icon name={l.visible ? "eye" : "eyeOff"} size={15} />
      </button>

      {isGroup
        ? <span className={styles.folderThumb}><Icon name={isCollapsed ? "folder" : "folderOpen"} size={17} /></span>
        : <Thumb layer={l} />}

      {renaming ? (
        <input
          className={styles.rename}
          defaultValue={l.name}
          autoFocus
          data-testid={`layer-rename-${l.id}`}
          onBlur={(e) => onEndRename(e.target.value.trim() || l.name)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") onEndRename("");
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span
          className={styles.name}
          title={isGroup ? "Double-click to rename this folder" : l.name}
          onDoubleClick={(e) => { e.stopPropagation(); if (editable) onStartRename(); }}
        >
          {!isGroup && (
            <span className={styles.kind} title={`${l.kind} layer`}><Icon name={KIND_ICON[l.kind]} size={14} /></span>
          )}
          <span className={styles.nameText}>{l.name}</span>
          {isGroup && <span className={styles.count} data-testid={`group-count-${l.id}`}>{count}</span>}
          {l.maskBlobId && <span className={styles.maskTag} title="Has layer mask"><Icon name="mask" size={12} /></span>}
        </span>
      )}

      {editable && (
        <div className={styles.itemActions} onClick={(e) => e.stopPropagation()}>
          {!isGroup && (
            <button title={maskOn ? "Stop editing mask" : "Edit layer mask"}
              aria-label={maskOn ? "Stop editing mask" : "Edit layer mask"}
              className={maskOn ? styles.maskActive : ""}
              onClick={() => onSetEditingMask(maskOn ? null : l.id)}><Icon name="mask" size={14} /></button>
          )}
          <button title="Move layer up" aria-label="Move layer up" onClick={() => onMove(l.id, -1)}><Icon name="arrowUp" size={14} /></button>
          <button title="Move layer down" aria-label="Move layer down" onClick={() => onMove(l.id, 1)}><Icon name="arrowDown" size={14} /></button>
          <button title={l.locked ? "Unlock layer" : "Lock layer"}
            aria-label={l.locked ? "Unlock layer" : "Lock layer"}
            onClick={() => onUpdateMeta(l.id, { locked: !l.locked })}><Icon name={l.locked ? "lock" : "unlock"} size={14} /></button>
          <button title={isGroup ? "Delete folder" : "Delete layer"}
            aria-label={isGroup ? "Delete folder" : "Delete layer"}
            className={styles.rowDel}
            onClick={() => onDelete(l.id)}><Icon name="trash" size={14} /></button>
        </div>
      )}
    </div>
  );
}

/** The editable color for a layer: fill layers use `fill`, text uses `text.color`. */
function layerColor(layer: Layer): string {
  if (layer.kind === "fill") return layer.fill || "#000000";
  if (layer.kind === "text") return layer.text?.color || "#000000";
  return "#000000";
}

function Thumb({ layer }: { layer: Layer }) {
  // A fill layer that hasn't been painted is a flat swatch; once it has pixels
  // (brush/bucket), show those instead.
  if (layer.kind === "fill" && !peekLayerCanvas(layer.id)) {
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
