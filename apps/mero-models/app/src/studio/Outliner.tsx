import { useMemo, useState, type ReactElement } from "react";
import { renameObject, setParent, setVisible } from "../editor/commands";
import { childrenIndex, type SceneObject } from "../editor/model";
import { useEditor } from "../editor/store";
import type { Peer } from "../editor/viewport";
import { IconChevron, IconEye, IconEyeOff, KindIcon } from "../ui/icons";

/**
 * The scene as a tree: click to select (Shift to add or remove, Ctrl to add),
 * the eye to hide, double-click to rename, drag a row onto another to put it
 * inside, or onto the empty space below to take it back out.
 */
export function Outliner({ peers }: { peers: Peer[] }) {
  const objects = useEditor((s) => s.objects);
  const selection = useEditor((s) => s.selection);
  const canEdit = useEditor((s) => s.role !== "viewer");
  const index = useMemo(() => childrenIndex(objects), [objects]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const selected = useMemo(() => new Set(selection), [selection]);

  const watching = useMemo(() => {
    const by = new Map<string, Peer[]>();
    for (const p of peers) {
      for (const id of p.selection) by.set(id, [...(by.get(id) ?? []), p]);
    }
    return by;
  }, [peers]);

  function onDrop(e: React.DragEvent, parent: string) {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const dragged = e.dataTransfer.getData("text/x-mero-object");
    if (!dragged) return;
    // Dragging a selected row moves the whole selection; any other row moves alone.
    const ids = selected.has(dragged) ? selection : [dragged];
    setParent(ids, parent, parent ? "Parent" : "Clear parent");
  }

  const rows: ReactElement[] = [];
  const walk = (parent: string, depth: number) => {
    for (const o of index.get(parent) ?? []) {
      const kids = index.get(o.id) ?? [];
      const open = !collapsed.has(o.id);
      rows.push(
        <Row
          key={o.id}
          obj={o}
          depth={depth}
          hasChildren={kids.length > 0}
          open={open}
          selected={selected.has(o.id)}
          active={selection.at(-1) === o.id}
          renaming={renaming === o.id}
          dropping={dropTarget === o.id}
          canEdit={canEdit}
          watchers={watching.get(o.id) ?? []}
          onToggleOpen={() => {
            const next = new Set(collapsed);
            if (open) next.add(o.id);
            else next.delete(o.id);
            setCollapsed(next);
          }}
          onSelect={(mode) => useEditor.getState().select([o.id], mode)}
          onRename={(name) => {
            setRenaming(null);
            if (name !== null) renameObject(o.id, name);
          }}
          onStartRename={() => canEdit && setRenaming(o.id)}
          onDragOver={(e) => {
            if (!canEdit) return;
            e.preventDefault();
            setDropTarget(o.id);
          }}
          onDrop={(e) => onDrop(e, o.id)}
        />,
      );
      if (open) walk(o.id, depth + 1);
    }
  };
  walk("", 0);

  return (
    <div
      className="outliner"
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDropTarget("");
      }}
      onDragLeave={() => setDropTarget(null)}
      onDrop={(e) => onDrop(e, "")}
      onClick={(e) => {
        if (e.target === e.currentTarget) useEditor.getState().select([]);
      }}
    >
      {rows.length === 0 ? (
        <p className="outliner-empty">The scene is empty. Add something from the Add menu (Shift+A).</p>
      ) : (
        <ul role="tree" aria-label="Scene objects">
          {rows}
        </ul>
      )}
      {dropTarget === "" && rows.length > 0 && <div className="drop-root">Drop here to move to the top level</div>}
    </div>
  );
}

function Row({
  obj,
  depth,
  hasChildren,
  open,
  selected,
  active,
  renaming,
  dropping,
  canEdit,
  watchers,
  onToggleOpen,
  onSelect,
  onRename,
  onStartRename,
  onDragOver,
  onDrop,
}: {
  obj: SceneObject;
  depth: number;
  hasChildren: boolean;
  open: boolean;
  selected: boolean;
  active: boolean;
  renaming: boolean;
  dropping: boolean;
  canEdit: boolean;
  watchers: Peer[];
  onToggleOpen: () => void;
  onSelect: (mode: "replace" | "add" | "toggle") => void;
  onRename: (name: string | null) => void;
  onStartRename: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  return (
    <li
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? open : undefined}
      className={`ol-row ${selected ? "selected" : ""} ${active ? "active" : ""} ${dropping ? "dropping" : ""} ${obj.visible ? "" : "hidden-obj"}`}
      style={{ paddingLeft: 6 + depth * 14 }}
      draggable={canEdit && !renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/x-mero-object", obj.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onClick={(e) => onSelect(e.shiftKey ? "toggle" : e.ctrlKey || e.metaKey ? "add" : "replace")}
      onDoubleClick={onStartRename}
      data-testid="outliner-row"
    >
      <button
        type="button"
        className={`ol-caret ${hasChildren ? "" : "none"} ${open ? "open" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
        }}
        tabIndex={-1}
        aria-label={open ? "Collapse" : "Expand"}
      >
        {hasChildren && <IconChevron size={12} />}
      </button>
      <KindIcon kind={obj.kind} className="ol-icon" />
      {renaming ? (
        <input
          className="ol-rename"
          autoFocus
          defaultValue={obj.name}
          onClick={(e) => e.stopPropagation()}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => onRename(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") onRename((e.target as HTMLInputElement).value);
            if (e.key === "Escape") onRename(null);
          }}
        />
      ) : (
        <span className="ol-name">{obj.name}</span>
      )}
      <span className="ol-watchers">
        {watchers.slice(0, 3).map((p) => (
          <span key={p.key} className="watcher-dot" style={{ background: p.color }} title={`${p.name} has this selected`} />
        ))}
      </span>
      <button
        type="button"
        className="ol-eye"
        disabled={!canEdit}
        title={obj.visible ? "Hide (H)" : "Show"}
        onClick={(e) => {
          e.stopPropagation();
          setVisible([obj.id], !obj.visible);
        }}
      >
        {obj.visible ? <IconEye size={14} /> : <IconEyeOff size={14} />}
      </button>
    </li>
  );
}
