import { useMemo, useRef, useState } from "react";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { useToast } from "../contexts/ToastContext";
import { createMutationReporter } from "../utils/mutationErrors";
import { escapeHtml, escapeCss } from "../utils/sanitize";
import {
  buildLayerTree,
  elementIdsOf,
  nameOf,
  renameElement,
  renameGroup,
  ungroupPath,
  type GroupNode,
  type LayerNode,
} from "../utils/groups";
import {
  applyLabelPatch,
  exportElementsAsPng,
  exportElementsAsSvg,
  flattenElements,
} from "../utils/groupOps";
import NumberField from "./ui/NumberField";
import Select from "./ui/Select";
import Slider from "./ui/Slider";
import ColorField from "./ui/ColorField";
import { Checkbox, Segmented, Switch } from "./ui/Toggle";
import LayerRowMenu from "./LayerRowMenu";
import { useGroupActions } from "../hooks/useGroupActions";
import type { Element } from "../types";
import styles from "./PropertiesPanel.module.css";
import controls from "./ui/controls.module.css";

const FONTS = [
  "sans-serif", "serif", "monospace",
  "Arial", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman",
  "Courier New", "Impact", "Comic Sans MS",
];

type PanelTab = "properties" | "layers" | "prototype";

interface Props {
  contextId: string;
  /** Viewers (no editor/admin role) can inspect but not mutate. */
  readOnly?: boolean;
}

export default function PropertiesPanel({ contextId, readOnly = false }: Props) {
  const {
    selectedElementId, selectedElementIds, elements, elementLabels, imageCache, background,
    collapsedGroups, upsertElement, removeElement, selectElement, selectElements, toggleSelected,
    setElementLabel, setElementLabels, toggleGroupCollapsed, cacheImage, snapshot,
  } = useCanvasStore();
  const el = elements.find((e) => e.id === selectedElementId);
  const { showToast } = useToast();
  // Contract mutations used to be `.catch(() => {})`. On a board running an older
  // bundle every layer move and corner-radius change failed silently, which is
  // indistinguishable from a UI bug. Report once per distinct failure.
  const reportFailure = useRef(createMutationReporter((m) => showToast(m, "error")));
  reportFailure.current = createMutationReporter((m) => showToast(m, "error"));
  const rpcDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tab, setTab] = useState<PanelTab>("properties");
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingGroupPath, setEditingGroupPath] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingFlatten, setPendingFlatten] = useState<string | null>(null);
  const [protoCopied, setProtoCopied] = useState(false);
  const [protoAllCopied, setProtoAllCopied] = useState(false);

  const selectedElements = useMemo(
    () => elements.filter((e) => selectedElementIds.includes(e.id)),
    [elements, selectedElementIds],
  );

  function scheduleRpc(fn: () => void) {
    if (rpcDebounceRef.current) clearTimeout(rpcDebounceRef.current);
    rpcDebounceRef.current = setTimeout(fn, 2000);
  }

  function update(patch: Record<string, unknown>) {
    if (readOnly || !el) return;
    const updated = { ...el, ...patch, updatedAt: Date.now() };
    upsertElement(updated);
    scheduleRpc(() =>
      rpcCall(contextId, "update_element", {
        id: el.id,
        x: null, y: null, width: null, height: null,
        rotation: null, fill: null, stroke: null,
        stroke_width: null, opacity: null, corner_radius: null,
        updated_at: updated.updatedAt,
        ...Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [toSnake(k), v]),
        ),
      }).catch((e) => reportFailure.current("update_element", e)),
    );
  }

  /** Same shape as `update`, but for one specific element (bulk edits). */
  function updateOne(target: Element, patch: Record<string, unknown>) {
    if (readOnly) return;
    const updated = { ...target, ...patch, updatedAt: Date.now() };
    upsertElement(updated);
    rpcCall(contextId, "update_element", {
      id: target.id,
      x: null, y: null, width: null, height: null,
      rotation: null, fill: null, stroke: null,
      stroke_width: null, opacity: null, corner_radius: null,
      updated_at: updated.updatedAt,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [toSnake(k), v])),
    }).catch((e) => reportFailure.current("update_element", e));
  }

  function updateTextStyle(patch: {
    content?: string;
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    // eslint-disable-next-line camelcase
    text_align?: "left" | "center" | "right";
    // eslint-disable-next-line camelcase
    vertical_align?: "top" | "middle" | "bottom";
  }) {
    if (readOnly || !el || el.data.kind !== "text") return;
    const updatedData = {
      ...el.data,
      ...(patch.content        !== undefined && { content:        patch.content }),
      ...(patch.fontFamily     !== undefined && { fontFamily:     patch.fontFamily }),
      ...(patch.fontSize       !== undefined && { fontSize:       patch.fontSize }),
      ...(patch.bold           !== undefined && { bold:           patch.bold }),
      ...(patch.italic         !== undefined && { italic:         patch.italic }),
      ...(patch.text_align     !== undefined && { text_align:     patch.text_align }),
      ...(patch.vertical_align !== undefined && { vertical_align: patch.vertical_align }),
    };
    const updated = { ...el, data: updatedData, updatedAt: Date.now() };
    upsertElement(updated);
    scheduleRpc(() =>
      rpcCall(contextId, "update_text_style", {
        id: el.id,
        content:        patch.content        ?? null,
        font_family:    patch.fontFamily     ?? null,
        font_size:      patch.fontSize       ?? null,
        bold:           patch.bold           ?? null,
        italic:         patch.italic         ?? null,
        text_align:     patch.text_align     ?? null,
        vertical_align: patch.vertical_align ?? null,
        updated_at:     updated.updatedAt,
      }).catch((e) => reportFailure.current("update_text_style", e)),
    );
  }

  async function handleDelete(targetId?: string) {
    if (readOnly) return;
    const id = targetId ?? el?.id;
    if (!id) return;
    snapshot();
    removeElement(id);
    await rpcCall(contextId, "delete_element", { id }).catch((e) => reportFailure.current("delete_element", e));
  }

  async function handleDeleteMany(ids: string[]) {
    if (readOnly || ids.length === 0) return;
    snapshot();
    for (const id of ids) {
      removeElement(id);
      await rpcCall(contextId, "delete_element", { id }).catch((e) => reportFailure.current("delete_element", e));
    }
    selectElements([]);
  }

  async function handleBringToFront(targetEl?: Element) {
    if (readOnly) return;
    const target = targetEl ?? el;
    if (!target) return;
    const maxLayer = Math.max(0, ...elements.map((e) => e.layerIndex));
    upsertElement({ ...target, layerIndex: maxLayer + 1, updatedAt: Date.now() });
    await rpcCall(contextId, "bring_to_front", { id: target.id }).catch((e) => reportFailure.current("bring_to_front", e));
  }

  async function handleSendToBack(targetEl?: Element) {
    if (readOnly) return;
    const target = targetEl ?? el;
    if (!target) return;
    elements.forEach((e) =>
      upsertElement({ ...e, layerIndex: e.id === target.id ? 0 : e.layerIndex + 1 })
    );
    await rpcCall(contextId, "send_to_back", { id: target.id }).catch((e) => reportFailure.current("send_to_back", e));
  }

  async function handleMoveUp(targetEl: Element) {
    if (readOnly) return;
    const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
    const idx = sorted.findIndex((e) => e.id === targetEl.id);
    if (idx >= sorted.length - 1) return;
    const above = sorted[idx + 1];
    const nowIdx = targetEl.layerIndex;
    const aboveIdx = above.layerIndex;
    upsertElement({ ...targetEl, layerIndex: aboveIdx, updatedAt: Date.now() });
    upsertElement({ ...above, layerIndex: nowIdx, updatedAt: Date.now() });
    // set_layer_index, not bring_to_front: the old call jumped the element to the
    // top in contract state, and the next sync overwrote this one-step swap.
    const upIndex = sorted.findIndex((e) => e.id === above.id);
    await rpcCall(contextId, "set_layer_index", {
      id: targetEl.id, index: upIndex, updated_at: Date.now(),
    }).catch((e) => reportFailure.current("set_layer_index", e));
  }

  async function handleMoveDown(targetEl: Element) {
    if (readOnly) return;
    const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
    const idx = sorted.findIndex((e) => e.id === targetEl.id);
    if (idx <= 0) return;
    const below = sorted[idx - 1];
    const nowIdx = targetEl.layerIndex;
    const belowIdx = below.layerIndex;
    upsertElement({ ...targetEl, layerIndex: belowIdx, updatedAt: Date.now() });
    upsertElement({ ...below, layerIndex: nowIdx, updatedAt: Date.now() });
    const downIndex = sorted.findIndex((e) => e.id === below.id);
    await rpcCall(contextId, "set_layer_index", {
      id: targetEl.id, index: downIndex, updated_at: Date.now(),
    }).catch((e) => reportFailure.current("set_layer_index", e));
  }

  /* ── groups ─────────────────────────────────────────────────────────── */

  const labelDeps = {
    contextId,
    applyLabels: setElementLabels,
    onError: (method: string, error: unknown) => reportFailure.current(method, error),
  };

  // Grouping lives in a hook so the canvas shortcuts (⌘G / ⇧⌘G) and these
  // buttons cannot drift apart.
  const { groupSelection, ungroupSelection, frameSelection } = useGroupActions(contextId, readOnly);

  async function handleGroupSelection() {
    await groupSelection();
    setTab("layers");
  }

  async function handleFrameSelection() {
    await frameSelection();
    setTab("layers");
  }

  async function handleUngroup(path: string) {
    if (readOnly) return;
    const patch = ungroupPath(elements, path);
    await applyLabelPatch(patch, labelDeps);
    showToast(`Ungrouped ${Object.keys(patch).length} layers`, "info");
  }

  function elementsOfNode(node: LayerNode): Element[] {
    const ids = new Set(elementIdsOf(node));
    return elements.filter((e) => ids.has(e.id));
  }

  async function withBusy(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function handleExportNode(node: LayerNode, format: "png" | "svg") {
    const members = elementsOfNode(node);
    const name = (node.kind === "group" ? node.name : node.name) || "selection";
    await withBusy(`${format}:${node.kind === "group" ? node.path : node.id}`, async () => {
      const options = {
        filename: `${name.replace(/[^\w .-]+/g, "-")}.${format}`,
        imageCache,
        background,
        padding: 8,
      };
      const ok = format === "png"
        ? await exportElementsAsPng(members, options)
        : await exportElementsAsSvg(members, options);
      if (ok) showToast(`Exported “${name}” as ${format.toUpperCase()}`, "success");
    });
  }

  async function handleFlatten(node: GroupNode) {
    if (readOnly) return;
    const members = elementsOfNode(node);
    if (members.length === 0) return;
    await withBusy(`flatten:${node.path}`, async () => {
      snapshot();
      await flattenElements(members, node.path, {
        ...labelDeps,
        imageCache,
        cacheImage,
        onFlattened: (created, removedIds) => {
          upsertElement(created);
          removedIds.forEach(removeElement);
          selectElement(created.id);
        },
      });
      showToast(`Merged ${members.length} layers into one image`, "success");
    });
    setPendingFlatten(null);
  }

  function startLabelEdit(node: LayerNode) {
    if (node.kind === "group") {
      setEditingGroupPath(node.path);
      setEditingLabelId(null);
    } else {
      setEditingLabelId(node.id);
      setEditingGroupPath(null);
    }
    setLabelDraft(node.name);
  }

  async function commitLabel() {
    const draft = labelDraft.trim();
    if (editingGroupPath) {
      const path = editingGroupPath;
      setEditingGroupPath(null);
      if (draft) await applyLabelPatch(renameGroup(elements, path, draft), labelDeps);
      return;
    }
    if (editingLabelId) {
      const target = elements.find((e) => e.id === editingLabelId);
      setEditingLabelId(null);
      if (target && draft) {
        const label = renameElement(target, draft);
        setElementLabel(target.id, label);
        await rpcCall(contextId, "update_element_label", {
          id: target.id, label, updated_at: Date.now(),
        }).catch((e) => reportFailure.current("update_element_label", e));
      }
    }
  }

  function getKindIcon(kind: string) {
    const map: Record<string, string> = {
      rect: "▭", circle: "◯", line: "╱", arrow: "→",
      path: "✏", text: "T", image: "⬜", svg: "S",
    };
    return map[kind] ?? "?";
  }

  /**
   * `offset` shifts the export so the top-left of the content sits at 0,0 — a
   * board with negative coordinates otherwise exports off-screen inside a
   * zero-sized wrapper.
   */
  function buildPrototypeHtml(e: Element, offset = { x: 0, y: 0 }): string {
    const opacity = (e.opacity / 100).toFixed(2);
    const rotation = e.rotation ? ` rotate(${e.rotation}deg)` : "";
    const fill = escapeCss(e.fill && e.fill !== "transparent" ? e.fill : "transparent");
    const strokeColor = escapeCss(e.stroke && e.stroke !== "transparent" && e.stroke !== "none" ? e.stroke : "");
    const border = strokeColor ? `${e.strokeWidth ?? 1}px solid ${strokeColor}` : "none";
    const shadowColor = escapeCss(e.shadowColor ?? "rgba(0,0,0,0.3)");
    const shadow = (e.shadowBlur ?? 0) > 0
      ? `box-shadow: ${e.shadowOffsetX ?? 0}px ${e.shadowOffsetY ?? 4}px ${e.shadowBlur}px ${shadowColor};`
      : "";
    const left = e.x - offset.x;
    const top = e.y - offset.y;
    const radius = e.cornerRadius ? ` border-radius: ${Math.round(e.cornerRadius)}px;` : "";
    const base = `position: absolute; left: ${left}px; top: ${top}px; width: ${e.width}px; height: ${e.height}px; opacity: ${opacity}; transform:${rotation || "none"}; background: ${fill}; border: ${border};${radius} ${shadow}`;

    // A line or arrow is a stroke, not a filled box: exporting it as a div gave a
    // solid rectangle. Emit real SVG instead.
    if (e.data.kind === "line" || e.data.kind === "arrow") {
      const colour = escapeCss(strokeColor || "#111111");
      const w = Math.max(1, e.strokeWidth || 2);
      const raw = (e.data.points ?? "").trim().split(/[\s,]+/).map(Number);
      const [x1, y1, x2, y2] = raw.length >= 4 && raw.every((n) => Number.isFinite(n))
        ? raw
        : [0, 0, e.width, e.height];
      const pad = w + (e.data.kind === "arrow" ? 12 : 0);
      const head = e.data.kind === "arrow"
        ? `<polygon points="${x2},${y2} ${x2 - 10},${y2 - 5} ${x2 - 10},${y2 + 5}" fill="${colour}" transform="rotate(${(Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI} ${x2} ${y2})" />`
        : "";
      return `<svg style="position: absolute; left: ${left - pad}px; top: ${top - pad}px; opacity: ${opacity}; overflow: visible;" width="${Math.abs(e.width) + pad * 2}" height="${Math.abs(e.height) + pad * 2}" viewBox="${-pad} ${-pad} ${Math.abs(e.width) + pad * 2} ${Math.abs(e.height) + pad * 2}"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${colour}" stroke-width="${w}" stroke-linecap="round" />${head}</svg>`;
    }

    if (e.data.kind === "text") {
      const fw = e.data.bold ? "bold" : "normal";
      const fi = e.data.italic ? "italic" : "normal";
      const ff = escapeCss(e.data.fontFamily ?? "sans-serif");
      const content = escapeHtml(e.data.content ?? "");
      const ta = e.data.text_align ?? "left";
      const va = e.data.vertical_align ?? "top";
      const justify = va === "middle" ? "center" : va === "bottom" ? "flex-end" : "flex-start";
      // The text colour is `fill`; `base` also puts `fill` in `background`, so the
      // old export painted every glyph in its own background colour. Text has no
      // box fill — drop it — and keep the outline as -webkit-text-stroke.
      const outline = strokeColor
        ? ` -webkit-text-stroke: ${e.strokeWidth ?? 1}px ${strokeColor};`
        : "";
      const boxless = base.replace(`background: ${fill};`, "background: transparent;").replace(`border: ${border};`, "border: none;");
      return `<div style="${boxless} font-family: ${ff}; font-size: ${e.data.fontSize ?? 24}px; font-weight: ${fw}; font-style: ${fi}; color: ${fill}; white-space: pre-wrap;${outline} display: flex; flex-direction: column; justify-content: ${justify}; text-align: ${ta};"><span>${content}</span></div>`;
    }
    if (e.data.kind === "circle") {
      return `<div style="${base} border-radius: 50%;"></div>`;
    }
    if (e.data.kind === "image" || e.data.kind === "svg") {
      // The src was hardcoded empty, so every exported image was a broken box.
      // imageCache holds a blob/data URL for anything already on the canvas.
      const src = escapeCss(imageCache[e.id] ?? "");
      const label = escapeHtml(e.label ?? "image");
      return `<img style="${base}" src="${src}" alt="${label}" />`;
    }
    return `<div style="${base}"></div>`;
  }

  function buildAllHtml(): string {
    const sorted = [...elements].sort((a, b) => a.layerIndex - b.layerIndex);
    if (!sorted.length) return `<div style="position: relative; width: 0; height: 0;"></div>`;
    // A `position: relative` wrapper with no size collapses to nothing, and
    // negative coordinates then render above the page. Shift to the origin and
    // state the size.
    const offset = {
      x: Math.min(...sorted.map((e) => e.x)),
      y: Math.min(...sorted.map((e) => e.y)),
    };
    const width = Math.max(...sorted.map((e) => e.x + e.width)) - offset.x;
    const height = Math.max(...sorted.map((e) => e.y + e.height)) - offset.y;
    const inner = sorted.map((e) => "  " + buildPrototypeHtml(e, offset)).join("\n");
    return `<div style="position: relative; width: ${width}px; height: ${height}px;">\n${inner}\n</div>`;
  }

  // ── LAYERS TAB ────────────────────────────────────────────────────────────────

  /**
   * The tree, filtered. A filter keeps any element whose name matches and any
   * group whose path matches — with 470 layers on the starter board, walking the
   * tree by hand is not a way to find anything.
   */
  const tree = useMemo(() => {
    const query = filter.trim().toLowerCase();
    const source = query
      ? elements.filter((e) => {
          const label = (elementLabels[e.id] ?? e.label ?? "").toLowerCase();
          return label.includes(query) || nameOf(e).toLowerCase().includes(query);
        })
      : elements;
    return buildLayerTree(source, elementLabels);
  }, [elements, elementLabels, filter]);

  function selectNode(node: LayerNode, e: React.MouseEvent) {
    const ids = elementIdsOf(node);
    if (e.shiftKey) {
      const merged = [...new Set([...selectedElementIds, ...ids])];
      selectElements(merged);
    } else if (e.metaKey || e.ctrlKey) {
      if (ids.length === 1) toggleSelected(ids[0]);
      else selectElements([...new Set([...selectedElementIds, ...ids])]);
    } else {
      selectElements(ids);
    }
  }

  function renderNode(node: LayerNode, depth: number): React.ReactNode {
    const indent = { paddingLeft: 6 + depth * 12 };

    if (node.kind === "group") {
      const collapsed = !!collapsedGroups[node.path] && !filter;
      const allSelected = node.elementIds.length > 0
        && node.elementIds.every((id) => selectedElementIds.includes(id));
      const someSelected = !allSelected && node.elementIds.some((id) => selectedElementIds.includes(id));
      return (
        <div key={`g:${node.path}`}>
          <div
            className={[
              styles.layerItem,
              styles.groupItem,
              allSelected ? styles.layerItemActive : "",
              someSelected ? styles.layerItemPartial : "",
            ].filter(Boolean).join(" ")}
            style={indent}
            data-testid={`layer-group-${node.path}`}
            onClick={(e) => selectNode(node, e)}
          >
            <button
              className={styles.disclosure}
              title={collapsed ? "Expand" : "Collapse"}
              data-testid={`layer-toggle-${node.path}`}
              onClick={(e) => { e.stopPropagation(); toggleGroupCollapsed(node.path); }}
            >
              {collapsed ? "▸" : "▾"}
            </button>
            <span className={styles.groupIcon} aria-hidden="true">▣</span>
            {editingGroupPath === node.path ? (
              <input
                autoFocus
                className={styles.layerLabelInput}
                value={labelDraft}
                onChange={(ev) => setLabelDraft(ev.target.value)}
                onBlur={commitLabel}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") commitLabel();
                  if (ev.key === "Escape") { ev.stopPropagation(); setEditingGroupPath(null); }
                }}
                onClick={(ev) => ev.stopPropagation()}
              />
            ) : (
              <span
                className={styles.layerName}
                onDoubleClick={(ev) => { ev.stopPropagation(); startLabelEdit(node); }}
              >
                {node.name}
              </span>
            )}
            <span className={styles.groupCount}>{node.elementIds.length}</span>
            <LayerRowMenu
              testId={`group-menu-${node.path}`}
              actions={[
                { label: "Select contents", onSelect: () => selectElements(node.elementIds) },
                { label: "Rename group", onSelect: () => startLabelEdit(node), disabled: readOnly },
                { label: "Ungroup", onSelect: () => handleUngroup(node.path), disabled: readOnly, testId: `ungroup-${node.path}` },
                { label: busy === `png:${node.path}` ? "Exporting…" : "Export PNG", onSelect: () => handleExportNode(node, "png"), testId: `export-group-png-${node.path}` },
                { label: busy === `svg:${node.path}` ? "Exporting…" : "Export SVG", onSelect: () => handleExportNode(node, "svg"), testId: `export-group-svg-${node.path}` },
                {
                  label: pendingFlatten === node.path ? "Merge — confirm" : "Merge into one image",
                  onSelect: () => {
                    if (pendingFlatten === node.path) handleFlatten(node);
                    else setPendingFlatten(node.path);
                  },
                  disabled: readOnly,
                  testId: `flatten-${node.path}`,
                },
                { label: `Delete ${node.elementIds.length} layers`, onSelect: () => handleDeleteMany(node.elementIds), danger: true, disabled: readOnly },
              ]}
            />
          </div>
          {!collapsed && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }

    const element = node.element;
    return (
      <div
        key={node.id}
        className={`${styles.layerItem} ${selectedElementIds.includes(node.id) ? styles.layerItemActive : ""}`}
        style={indent}
        data-testid={`layer-item-${node.id}`}
        onClick={(e) => selectNode(node, e)}
      >
        <span className={styles.layerIcon}>{getKindIcon(element.data.kind)}</span>
        {editingLabelId === node.id ? (
          <input
            autoFocus
            className={styles.layerLabelInput}
            value={labelDraft}
            onChange={(ev) => setLabelDraft(ev.target.value)}
            onBlur={commitLabel}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") commitLabel();
              if (ev.key === "Escape") { ev.stopPropagation(); setEditingLabelId(null); }
            }}
            onClick={(ev) => ev.stopPropagation()}
          />
        ) : (
          <span className={styles.layerName} title={node.path || node.name} onDoubleClick={(ev) => { ev.stopPropagation(); startLabelEdit(node); }}>
            {node.name}
          </span>
        )}
        <div className={styles.layerActions}>
          <button
            className={styles.layerOrderBtn}
            title="Move up"
            data-testid={`layer-up-${node.id}`}
            onClick={(ev) => { ev.stopPropagation(); handleMoveUp(element); }}
          >↑</button>
          <button
            className={styles.layerOrderBtn}
            title="Move down"
            data-testid={`layer-down-${node.id}`}
            onClick={(ev) => { ev.stopPropagation(); handleMoveDown(element); }}
          >↓</button>
          <button
            className={styles.layerDeleteBtn}
            onClick={(ev) => { ev.stopPropagation(); handleDelete(node.id); }}
            title="Delete"
          >×</button>
        </div>
      </div>
    );
  }

  const layersPanelContent = (
    <div className={styles.layersPane}>
      <div className={styles.layersToolbar}>
        <input
          className={styles.layerFilter}
          placeholder="Find a layer…"
          value={filter}
          data-testid="layer-filter"
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setFilter(""); } }}
        />
        <div className={styles.layersActions}>
          <button
            className={controls.iconButton}
            disabled={readOnly || selectedElementIds.length < 2}
            title="Group the selected layers (⌘G)"
            data-testid="group-selection"
            onClick={handleGroupSelection}
          >Group</button>
          <button
            className={controls.iconButton}
            disabled={readOnly || selectedElementIds.length === 0}
            title="Ungroup (⇧⌘G)"
            data-testid="ungroup-selection"
            onClick={ungroupSelection}
          >Ungroup</button>
          <button
            className={controls.iconButton}
            disabled={readOnly || selectedElementIds.length === 0}
            title="Wrap the selection in a frame"
            data-testid="frame-selection"
            onClick={handleFrameSelection}
          >Frame</button>
        </div>
      </div>

      <div className={styles.layerList}>
        {tree.map((node) => renderNode(node, 0))}
        {elements.length === 0 && <p className={styles.hint}>No elements yet.</p>}
        {elements.length > 0 && tree.length === 0 && (
          <p className={styles.hint}>No layer matches “{filter}”.</p>
        )}
      </div>
    </div>
  );

  // ── PROTOTYPE TAB ─────────────────────────────────────────────────────────────
  const protoCode = el ? buildPrototypeHtml(el) : null;
  const allHtml = buildAllHtml();

  const protoPanel = (
    <div className={styles.protoPanel}>
      <div className={styles.protoSection}>
        <div className={styles.protoHeader}>
          <span className={styles.protoLabel}>All elements</span>
          <button className={styles.copyBtn} onClick={async () => {
            await navigator.clipboard.writeText(allHtml);
            setProtoAllCopied(true);
            setTimeout(() => setProtoAllCopied(false), 2000);
          }}>
            {protoAllCopied ? "Copied!" : "Copy all"}
          </button>
        </div>
        <pre className={styles.protoCode}>{allHtml}</pre>
      </div>

      {protoCode && (
        <div className={styles.protoSection}>
          <div className={styles.protoHeader}>
            <span className={styles.protoLabel}>Selected</span>
            <button className={styles.copyBtn} onClick={async () => {
              await navigator.clipboard.writeText(protoCode);
              setProtoCopied(true);
              setTimeout(() => setProtoCopied(false), 2000);
            }}>
              {protoCopied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className={styles.protoCode}>{protoCode}</pre>
        </div>
      )}

      {!protoCode && (
        <p className={styles.hint}>Select an element to see its HTML.</p>
      )}
    </div>
  );

  // ── PROPERTIES TAB ────────────────────────────────────────────────────────────

  /** Bulk alignment for a multi-selection, against the selection's own bounds. */
  function alignSelection(edge: "left" | "hcenter" | "right" | "top" | "vmiddle" | "bottom") {
    if (readOnly || selectedElements.length < 2) return;
    const minX = Math.min(...selectedElements.map((e) => e.x));
    const maxX = Math.max(...selectedElements.map((e) => e.x + e.width));
    const minY = Math.min(...selectedElements.map((e) => e.y));
    const maxY = Math.max(...selectedElements.map((e) => e.y + e.height));
    snapshot();
    for (const target of selectedElements) {
      switch (edge) {
        case "left":    updateOne(target, { x: Math.round(minX) }); break;
        case "right":   updateOne(target, { x: Math.round(maxX - target.width) }); break;
        case "hcenter": updateOne(target, { x: Math.round((minX + maxX) / 2 - target.width / 2) }); break;
        case "top":     updateOne(target, { y: Math.round(minY) }); break;
        case "bottom":  updateOne(target, { y: Math.round(maxY - target.height) }); break;
        case "vmiddle": updateOne(target, { y: Math.round((minY + maxY) / 2 - target.height / 2) }); break;
      }
    }
  }

  const multiPanel = (
    <div className={styles.propContent}>
      <div className={styles.kindRow}>
        <span className={styles.kindBadge}>{selectedElementIds.length} selected</span>
        <button
          className={controls.iconButton}
          data-testid="clear-selection"
          onClick={() => selectElements([])}
        >Clear</button>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Align</div>
        <div className={styles.alignGrid}>
          {([
            ["left", "⇤", "Align left"],
            ["hcenter", "⇹", "Align horizontal centres"],
            ["right", "⇥", "Align right"],
            ["top", "⤒", "Align top"],
            ["vmiddle", "⇳", "Align vertical centres"],
            ["bottom", "⤓", "Align bottom"],
          ] as const).map(([edge, glyph, title]) => (
            <button
              key={edge}
              className={controls.iconButton}
              title={title}
              disabled={readOnly}
              data-testid={`align-${edge}`}
              onClick={() => alignSelection(edge)}
            >{glyph}</button>
          ))}
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Organise</div>
        <div className={styles.stackRow}>
          <button className={controls.iconButton} disabled={readOnly} data-testid="group-selection-props" onClick={handleGroupSelection}>Group</button>
          <button className={controls.iconButton} disabled={readOnly} onClick={handleFrameSelection}>Frame</button>
          <button className={controls.iconButton} disabled={readOnly} onClick={ungroupSelection}>Ungroup</button>
        </div>
        <div className={styles.stackRow} style={{ marginTop: 6 }}>
          <button
            className={controls.iconButton}
            data-testid="export-selection-png"
            onClick={() => handleExportNode({ kind: "group", path: "selection", name: "selection", children: [], elementIds: selectedElementIds, layerIndex: 0 }, "png")}
          >Export PNG</button>
          <button
            className={controls.iconButton}
            data-testid="export-selection-svg"
            onClick={() => handleExportNode({ kind: "group", path: "selection", name: "selection", children: [], elementIds: selectedElementIds, layerIndex: 0 }, "svg")}
          >Export SVG</button>
        </div>
      </div>

      <div className={styles.deleteRow}>
        <button
          className={`${controls.iconButton} ${controls.iconButtonDanger}`}
          disabled={readOnly}
          data-testid="delete-selection"
          onClick={() => handleDeleteMany(selectedElementIds)}
        >
          Delete {selectedElementIds.length} layers
        </button>
      </div>
    </div>
  );

  const propertiesPanel = selectedElementIds.length > 1 ? multiPanel : !el ? (
    <div className={styles.emptyState}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M3 9h18M9 21V9"/>
      </svg>
      <p>Select an element to edit its properties.</p>
    </div>
  ) : (
    <div className={styles.propContent}>

      {/* Kind badge */}
      <div className={styles.kindRow}>
        <span className={styles.kindBadge}>{el.data.kind}</span>
        <div className={styles.layerBtns}>
          <button className={controls.iconButton} title="Bring to Front" data-testid="bring-to-front" onClick={() => handleBringToFront()}>↑ Front</button>
          <button className={controls.iconButton} title="Send to Back" data-testid="send-to-back" onClick={() => handleSendToBack()}>↓ Back</button>
        </div>
      </div>

      {/* Name */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Name</div>
        <input
          className={styles.textInput}
          value={nameOf(el)}
          data-testid="element-name"
          disabled={readOnly}
          onChange={(e) => {
            const label = renameElement(el, e.target.value);
            setElementLabel(el.id, label);
          }}
          onBlur={() => {
            rpcCall(contextId, "update_element_label", {
              id: el.id, label: el.label ?? "", updated_at: Date.now(),
            }).catch((e) => reportFailure.current("update_element_label", e));
          }}
        />
      </div>

      {/* Position + Size */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Position &amp; Size</div>
        <div className={styles.grid2}>
          <NumberField label="X" value={el.x} disabled={readOnly} testId="prop-x"
            onChange={(v) => update({ x: v })} />
          <NumberField label="Y" value={el.y} disabled={readOnly} testId="prop-y"
            onChange={(v) => update({ y: v })} />
          <NumberField label="W" min={1} value={el.width} disabled={readOnly} testId="prop-w"
            onChange={(v) => update({ width: v })} />
          <NumberField label="H" min={1} value={el.height} disabled={readOnly} testId="prop-h"
            onChange={(v) => update({ height: v })} />
          <NumberField label="∠" suffix="°" value={el.rotation} disabled={readOnly} testId="prop-rotation"
            onChange={(v) => update({ rotation: v })} />
          {/* item 14: corner radius, clamped so a large value cannot invert the shape */}
          {el.data.kind === "rect" && (
            <NumberField
              label="⌒"
              min={0}
              max={Math.floor(Math.min(el.width, el.height) / 2)}
              value={el.cornerRadius ?? 0}
              disabled={readOnly}
              testId="prop-corner-radius"
              title="Corner radius"
              onChange={(v) => update({ cornerRadius: v })}
            />
          )}
        </div>
      </div>

      {/* Text */}
      {el.data.kind === "text" && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Text</div>
          <textarea
            className={styles.textarea}
            value={el.data.content ?? ""}
            disabled={readOnly}
            data-testid="prop-text-content"
            onChange={(e) => updateTextStyle({ content: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Escape") e.stopPropagation(); }}
            rows={2}
          />
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel}>Font</label>
            <Select
              value={el.data.fontFamily ?? "sans-serif"}
              disabled={readOnly}
              testId="prop-font"
              ariaLabel="Font family"
              options={FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: f } }))}
              onChange={(f) => updateTextStyle({ fontFamily: f })}
            />
          </div>
          <div className={styles.grid2} style={{ marginTop: 6 }}>
            <NumberField
              label="Aa" min={6} max={288} value={el.data.fontSize ?? 24}
              disabled={readOnly} testId="prop-font-size" title="Font size"
              onChange={(v) => updateTextStyle({ fontSize: v })}
            />
            <Segmented
              value={null}
              ariaLabel="Font style"
              disabled={readOnly}
              segments={[
                { value: "bold", content: "B", title: "Bold", style: { fontWeight: 700, color: el.data.bold ? "var(--c-accent)" : undefined } },
                { value: "italic", content: "I", title: "Italic", style: { fontStyle: "italic", color: el.data.italic ? "var(--c-accent)" : undefined } },
              ]}
              onChange={(v) => updateTextStyle(v === "bold" ? { bold: !el.data.bold } : { italic: !el.data.italic })}
            />
          </div>

          <div className={styles.fieldStack} style={{ marginTop: 6 }}>
            <label className={styles.fieldLabel}>Align</label>
            <Segmented
              testId="align-h-btns"
              ariaLabel="Horizontal alignment"
              disabled={readOnly}
              value={el.data.text_align ?? "left"}
              segments={[
                { value: "left", content: "⇤", title: "Align left", testId: "align-h-left" },
                { value: "center", content: "≡", title: "Align centre", testId: "align-h-center" },
                { value: "right", content: "⇥", title: "Align right", testId: "align-h-right" },
              ]}
              onChange={(a) => updateTextStyle({ text_align: a })}
            />
          </div>

          <div className={styles.fieldStack} style={{ marginTop: 6 }}>
            <label className={styles.fieldLabel}>Vertical</label>
            <Segmented
              testId="align-v-btns"
              ariaLabel="Vertical alignment"
              disabled={readOnly}
              value={el.data.vertical_align ?? "top"}
              segments={[
                { value: "top", content: "⤒", title: "Align top", testId: "align-v-top" },
                { value: "middle", content: "⇳", title: "Align middle", testId: "align-v-middle" },
                { value: "bottom", content: "⤓", title: "Align bottom", testId: "align-v-bottom" },
              ]}
              onChange={(a) => updateTextStyle({ vertical_align: a })}
            />
          </div>
        </div>
      )}

      {/* Appearance */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Appearance</div>

        <div className={styles.colorRow}>
          <Checkbox
            checked={!!el.fill && el.fill !== "transparent"}
            disabled={readOnly}
            testId="fill-toggle"
            label="Fill"
            onChange={(on) => update({ fill: on ? "#4F8EF7" : "transparent" })}
          />
          {el.fill && el.fill !== "transparent" ? (
            <ColorField value={el.fill} disabled={readOnly} testId="fill-color" title="Fill colour"
              onChange={(c) => update({ fill: c })} />
          ) : (
            <span className={styles.colorNone}>—</span>
          )}
        </div>

        <div className={styles.colorRow}>
          <Checkbox
            checked={!!el.stroke && el.stroke !== "transparent" && el.stroke !== "none"}
            disabled={readOnly}
            testId="stroke-toggle"
            label="Stroke"
            onChange={(on) => update({ stroke: on ? "#000000" : "transparent" })}
          />
          {el.stroke && el.stroke !== "transparent" && el.stroke !== "none" ? (
            <ColorField value={el.stroke} disabled={readOnly} testId="stroke-color" title="Stroke colour"
              onChange={(c) => update({ stroke: c })} />
          ) : (
            <span className={styles.colorNone}>—</span>
          )}
        </div>

        {el.stroke && el.stroke !== "transparent" && el.stroke !== "none" && (
          <div className={styles.fieldRow}>
            <label className={styles.fieldLabel}>Width</label>
            <NumberField
              min={1} max={50} value={el.strokeWidth} disabled={readOnly} testId="prop-stroke-width"
              onChange={(v) => update({ strokeWidth: v })}
            />
          </div>
        )}

        <div className={styles.opacityRow}>
          <span className={styles.fieldLabel}>Opacity</span>
          <Slider
            value={el.opacity} min={0} max={100} disabled={readOnly}
            testId="opacity-slider" ariaLabel="Opacity"
            onChange={(v) => update({ opacity: v })}
          />
          <NumberField
            value={el.opacity} min={0} max={100} suffix="%" disabled={readOnly}
            testId="prop-opacity" className={styles.opacityNumber}
            onChange={(v) => update({ opacity: v })}
          />
        </div>
      </div>

      {/* Shadow */}
      <div className={styles.group}>
        <div className={styles.shadowRow}>
          <div className={styles.groupTitle} style={{ marginBottom: 0 }}>Shadow</div>
          <Switch
            checked={(el.shadowBlur ?? 0) > 0}
            disabled={readOnly}
            testId="shadow-toggle"
            onChange={(on) => {
              const updatedAt = Date.now();
              if (on) {
                upsertElement({ ...el, shadowColor: "rgba(0,0,0,0.3)", shadowOffsetX: 0, shadowOffsetY: 4, shadowBlur: 12, updatedAt });
                rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: "rgba(0,0,0,0.3)", shadow_offset_x: 0, shadow_offset_y: 4, shadow_blur: 12, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
              } else {
                upsertElement({ ...el, shadowColor: null, shadowOffsetX: null, shadowOffsetY: null, shadowBlur: null, updatedAt });
                rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
              }
            }}
          />
        </div>

        {(el.shadowBlur ?? 0) > 0 && (
          <>
            <div className={styles.fieldRow} style={{ marginTop: 6 }}>
              <label className={styles.fieldLabel}>Colour</label>
              <ColorField
                value={el.shadowColor?.startsWith("rgba") ? "#000000" : (el.shadowColor ?? "#000000")}
                disabled={readOnly}
                testId="shadow-color"
                onChange={(c) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowColor: c, updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: c, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }}
              />
            </div>
            <div className={styles.grid2} style={{ marginTop: 6 }}>
              <NumberField
                label="Blur" min={0} max={50} value={el.shadowBlur ?? 0} disabled={readOnly} testId="shadow-blur"
                onChange={(v) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowBlur: v, updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: v, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }}
              />
              <NumberField
                label="X" value={el.shadowOffsetX ?? 0} disabled={readOnly} testId="shadow-x"
                onChange={(v) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowOffsetX: v, updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: v, shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }}
              />
              <NumberField
                label="Y" value={el.shadowOffsetY ?? 0} disabled={readOnly} testId="shadow-y"
                onChange={(v) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowOffsetY: v, updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: v, shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Export + delete */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Export</div>
        <div className={styles.stackRow}>
          <button
            className={controls.iconButton}
            data-testid="export-element-png"
            onClick={() => handleExportNode({ kind: "element", id: el.id, name: nameOf(el), path: el.label ?? "", element: el, layerIndex: el.layerIndex }, "png")}
          >PNG</button>
          <button
            className={controls.iconButton}
            data-testid="export-element-svg"
            onClick={() => handleExportNode({ kind: "element", id: el.id, name: nameOf(el), path: el.label ?? "", element: el, layerIndex: el.layerIndex }, "svg")}
          >SVG</button>
        </div>
      </div>

      <div className={styles.deleteRow}>
        <button
          className={`${controls.iconButton} ${controls.iconButtonDanger}`}
          data-testid="delete-element"
          disabled={readOnly}
          onClick={() => handleDelete()}
        >
          Delete element
        </button>
      </div>

    </div>
  );

  return (
    <div className={`${styles.panel} ${controls.kit}`}>
      <div className={styles.tabBar}>
        {(["properties", "layers", "prototype"] as PanelTab[]).map((t) => (
          <button key={t} className={`${styles.tabBtn} ${tab === t ? styles.tabBtnActive : ""}`} onClick={() => setTab(t)}>
            {t === "properties" ? "Props" : t === "layers" ? "Layers" : "Proto"}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {tab === "properties" && propertiesPanel}
        {tab === "layers" && layersPanelContent}
        {tab === "prototype" && protoPanel}
      </div>
    </div>
  );
}

function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
