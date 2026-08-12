import { useRef, useState } from "react";
import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import { useToast } from "../contexts/ToastContext";
import { createMutationReporter } from "../utils/mutationErrors";
import { escapeHtml, escapeCss } from "../utils/sanitize";
import type { Element } from "../types";
import styles from "./PropertiesPanel.module.css";

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
  const { selectedElementId, selectedElementIds, elements, elementLabels, imageCache, upsertElement, removeElement, selectElement, selectElements, setElementLabel } = useCanvasStore();
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
  const [labelDraft, setLabelDraft] = useState("");
  const [protoCopied, setProtoCopied] = useState(false);
  const [protoAllCopied, setProtoAllCopied] = useState(false);

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
    removeElement(id);
    await rpcCall(contextId, "delete_element", { id }).catch((e) => reportFailure.current("delete_element", e));
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

  function startLabelEdit(e: Element) {
    setEditingLabelId(e.id);
    setLabelDraft(elementLabels[e.id] ?? e.data.kind);
  }

  function commitLabel() {
    if (editingLabelId) setElementLabel(editingLabelId, labelDraft.trim() || editingLabelId.slice(0, 6));
    setEditingLabelId(null);
  }

  function getElementLabel(e: Element) {
    return elementLabels[e.id] || `${e.data.kind}`;
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
  const sortedLayers = [...elements].sort((a, b) => b.layerIndex - a.layerIndex);

  const layersPanelContent = (
    <div className={styles.layerList}>
      {sortedLayers.map((e) => (
        <div
          key={e.id}
          className={`${styles.layerItem} ${selectedElementIds.includes(e.id) ? styles.layerItemActive : ""}`}
          onClick={(ev) => {
            if (ev.shiftKey) {
              const next = selectedElementIds.includes(e.id)
                ? selectedElementIds.filter((id) => id !== e.id)
                : [...selectedElementIds, e.id];
              selectElements(next.length > 0 ? next : [e.id]);
            } else {
              selectElement(e.id);
            }
          }}
        >
          <span className={styles.layerIcon}>{getKindIcon(e.data.kind)}</span>
          {editingLabelId === e.id ? (
            <input
              autoFocus
              className={styles.layerLabelInput}
              value={labelDraft}
              onChange={(ev) => setLabelDraft(ev.target.value)}
              onBlur={commitLabel}
              onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === "Escape") commitLabel(); }}
              onClick={(ev) => ev.stopPropagation()}
            />
          ) : (
            <span className={styles.layerName} onDoubleClick={(ev) => { ev.stopPropagation(); startLabelEdit(e); }}>
              {getElementLabel(e)}
            </span>
          )}
          <div className={styles.layerActions}>
            <button
              className={styles.layerOrderBtn}
              title="Move up"
              data-testid={`layer-up-${e.id}`}
              onClick={(ev) => { ev.stopPropagation(); handleMoveUp(e); }}
            >↑</button>
            <button
              className={styles.layerOrderBtn}
              title="Move down"
              data-testid={`layer-down-${e.id}`}
              onClick={(ev) => { ev.stopPropagation(); handleMoveDown(e); }}
            >↓</button>
            <button
              className={styles.layerDeleteBtn}
              onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }}
              title="Delete"
            >×</button>
          </div>
        </div>
      ))}
      {elements.length === 0 && <p className={styles.hint}>No elements yet.</p>}
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
  const propertiesPanel = selectedElementIds.length > 1 ? (
    <div className={styles.emptyState}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round">
        <rect x="2" y="2" width="9" height="9" rx="1"/><rect x="13" y="2" width="9" height="9" rx="1"/>
        <rect x="2" y="13" width="9" height="9" rx="1"/><rect x="13" y="13" width="9" height="9" rx="1"/>
      </svg>
      <p>{selectedElementIds.length} elements selected</p>
    </div>
  ) : !el ? (
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
          <button className={styles.layerBtn} title="Bring to Front" data-testid="bring-to-front" onClick={() => handleBringToFront()}>↑ Front</button>
          <button className={styles.layerBtn} title="Send to Back" data-testid="send-to-back" onClick={() => handleSendToBack()}>↓ Back</button>
        </div>
      </div>

      {/* Position + Size */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Position &amp; Size</div>
        <div className={styles.grid2}>
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel}>X</label>
            <input type="number" className={styles.field}
              value={el.x} onChange={(e) => update({ x: Number(e.target.value) })} />
          </div>
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel}>Y</label>
            <input type="number" className={styles.field}
              value={el.y} onChange={(e) => update({ y: Number(e.target.value) })} />
          </div>
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel}>W</label>
            <input type="number" className={styles.field} min={1}
              value={el.width} onChange={(e) => update({ width: Math.max(1, Number(e.target.value)) })} />
          </div>
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel}>H</label>
            <input type="number" className={styles.field} min={1}
              value={el.height} onChange={(e) => update({ height: Math.max(1, Number(e.target.value)) })} />
          </div>
          <div className={styles.fieldWrap} style={{ gridColumn: "span 2" }}>
            <label className={styles.fieldLabel}>Rotation</label>
            <input type="number" className={styles.field}
              value={el.rotation} onChange={(e) => update({ rotation: Number(e.target.value) })} />
          </div>
          {/* item 14: corner radius, clamped so a large value cannot invert the shape */}
          {el.data.kind === "rect" && (
            <div className={styles.fieldWrap} style={{ gridColumn: "span 2" }}>
              <label className={styles.fieldLabel}>Corner radius</label>
              <input
                type="number"
                className={styles.field}
                min={0}
                max={Math.floor(Math.min(el.width, el.height) / 2)}
                data-testid="prop-corner-radius"
                value={el.cornerRadius ?? 0}
                onChange={(e) =>
                  update({
                    cornerRadius: Math.max(
                      0,
                      Math.min(Number(e.target.value) || 0, Math.floor(Math.min(el.width, el.height) / 2)),
                    ),
                  })
                }
              />
            </div>
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
            onChange={(e) => updateTextStyle({ content: e.target.value })}
            rows={2}
          />
          <div className={styles.grid2}>
            <div className={styles.fieldWrap} style={{ gridColumn: "span 2" }}>
              <label className={styles.fieldLabel}>Font</label>
              <select className={styles.select}
                value={el.data.fontFamily ?? "sans-serif"}
                onChange={(e) => updateTextStyle({ fontFamily: e.target.value })}>
                {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
              </select>
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Size</label>
              <input type="number" className={styles.field} min={6} max={288}
                value={el.data.fontSize ?? 24}
                onChange={(e) => updateTextStyle({ fontSize: Number(e.target.value) })} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Style</label>
              <div className={styles.styleBtns}>
                <button
                  className={`${styles.styleBtn} ${el.data.bold ? styles.styleBtnActive : ""}`}
                  style={{ fontWeight: "bold" }}
                  onClick={() => updateTextStyle({ bold: !el.data.bold })}
                >B</button>
                <button
                  className={`${styles.styleBtn} ${el.data.italic ? styles.styleBtnActive : ""}`}
                  style={{ fontStyle: "italic" }}
                  onClick={() => updateTextStyle({ italic: !el.data.italic })}
                >I</button>
              </div>
            </div>
          </div>

          {/* Horizontal alignment */}
          <div className={styles.fieldWrap} style={{ marginTop: 6 }}>
            <label className={styles.fieldLabel}>Align H</label>
            <div className={styles.styleBtns} data-testid="align-h-btns">
              {(["left", "center", "right"] as const).map((a) => (
                <button
                  key={a}
                  data-testid={`align-h-${a}`}
                  className={`${styles.styleBtn} ${(el.data.text_align ?? "left") === a ? styles.styleBtnActive : ""}`}
                  title={`Align ${a}`}
                  onClick={() => updateTextStyle({ text_align: a })}
                >{a === "left" ? "⇐" : a === "center" ? "≡" : "⇒"}</button>
              ))}
            </div>
          </div>

          {/* Vertical alignment */}
          <div className={styles.fieldWrap} style={{ marginTop: 4 }}>
            <label className={styles.fieldLabel}>Align V</label>
            <div className={styles.styleBtns} data-testid="align-v-btns">
              {(["top", "middle", "bottom"] as const).map((a) => (
                <button
                  key={a}
                  data-testid={`align-v-${a}`}
                  className={`${styles.styleBtn} ${(el.data.vertical_align ?? "top") === a ? styles.styleBtnActive : ""}`}
                  title={`Align ${a}`}
                  onClick={() => updateTextStyle({ vertical_align: a })}
                >{a === "top" ? "⇈" : a === "middle" ? "↕" : "⇊"}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Appearance */}
      <div className={styles.group}>
        <div className={styles.groupTitle}>Appearance</div>

        {/* Fill */}
        <div className={styles.colorRow}>
          <input
            type="checkbox"
            className={styles.check}
            checked={!!el.fill && el.fill !== "transparent"}
            onChange={(e) => update({ fill: e.target.checked ? "#4F8EF7" : "transparent" })}
          />
          <span className={styles.colorLabel}>Fill</span>
          {el.fill && el.fill !== "transparent" ? (
            <input type="color" className={styles.colorSwatch}
              value={el.fill} data-testid="fill-color"
              onChange={(e) => update({ fill: e.target.value })} />
          ) : (
            <span className={styles.colorNone}>—</span>
          )}
          {el.fill && el.fill !== "transparent" && (
            <span className={styles.colorHex}>{el.fill}</span>
          )}
        </div>

        {/* Stroke */}
        <div className={styles.colorRow}>
          <input
            type="checkbox"
            className={styles.check}
            checked={!!el.stroke && el.stroke !== "transparent" && el.stroke !== "none"}
            onChange={(e) => update({ stroke: e.target.checked ? "#000000" : "transparent" })}
          />
          <span className={styles.colorLabel}>Stroke</span>
          {el.stroke && el.stroke !== "transparent" && el.stroke !== "none" ? (
            <input type="color" className={styles.colorSwatch}
              value={el.stroke} data-testid="stroke-color"
              onChange={(e) => update({ stroke: e.target.value })} />
          ) : (
            <span className={styles.colorNone}>—</span>
          )}
          {el.stroke && el.stroke !== "transparent" && el.stroke !== "none" && (
            <span className={styles.colorHex}>{el.stroke}</span>
          )}
        </div>

        {el.stroke && el.stroke !== "transparent" && el.stroke !== "none" && (
          <div className={styles.fieldWrap} style={{ marginTop: 4 }}>
            <label className={styles.fieldLabel}>Stroke W</label>
            <input type="number" className={styles.field} min={1} max={50}
              value={el.strokeWidth}
              onChange={(e) => update({ strokeWidth: Number(e.target.value) })} />
          </div>
        )}

        {/* Opacity */}
        <div className={styles.opacityRow}>
          <span className={styles.colorLabel}>Opacity</span>
          <input type="range" min={0} max={100}
            value={el.opacity} className={styles.slider}
            data-testid="opacity-slider"
            onChange={(e) => update({ opacity: Number(e.target.value) })} />
          <span className={styles.opacityVal}>{el.opacity}%</span>
        </div>
      </div>

      {/* Shadow */}
      <div className={styles.group}>
        <div className={styles.shadowRow}>
          <div className={styles.groupTitle} style={{ marginBottom: 0 }}>Shadow</div>
          <input type="checkbox" className={styles.check}
            disabled={readOnly}
            checked={(el.shadowBlur ?? 0) > 0}
            onChange={(e) => {
              const updatedAt = Date.now();
              if (e.target.checked) {
                upsertElement({ ...el, shadowColor: "rgba(0,0,0,0.3)", shadowOffsetX: 0, shadowOffsetY: 4, shadowBlur: 12, updatedAt });
                rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: "rgba(0,0,0,0.3)", shadow_offset_x: 0, shadow_offset_y: 4, shadow_blur: 12, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
              } else {
                upsertElement({ ...el, shadowColor: null, shadowOffsetX: null, shadowOffsetY: null, shadowBlur: null, updatedAt });
                rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: null, shadow_offset_x: null, shadow_offset_y: null, shadow_blur: null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
              }
            }} />
        </div>

        {(el.shadowBlur ?? 0) > 0 && (
          <div className={styles.grid2} style={{ marginTop: 6 }}>
            <div className={styles.fieldWrap} style={{ gridColumn: "span 2" }}>
              <label className={styles.fieldLabel}>Color</label>
              <input type="color" className={styles.colorSwatch}
                disabled={readOnly}
                value={el.shadowColor?.startsWith("rgba") ? "#000000" : (el.shadowColor ?? "#000000")}
                onChange={(e) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowColor: e.target.value, updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: e.target.value, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Blur</label>
              <input type="number" className={styles.field} min={0} max={50}
                disabled={readOnly}
                value={el.shadowBlur ?? 0}
                onChange={(e) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowBlur: Number(e.target.value), updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: Number(e.target.value), updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Offset X</label>
              <input type="number" className={styles.field}
                disabled={readOnly}
                value={el.shadowOffsetX ?? 0}
                onChange={(e) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowOffsetX: Number(e.target.value), updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: Number(e.target.value), shadow_offset_y: el.shadowOffsetY ?? null, shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }} />
            </div>
            <div className={styles.fieldWrap}>
              <label className={styles.fieldLabel}>Offset Y</label>
              <input type="number" className={styles.field}
                disabled={readOnly}
                value={el.shadowOffsetY ?? 0}
                onChange={(e) => {
                  const updatedAt = Date.now();
                  upsertElement({ ...el, shadowOffsetY: Number(e.target.value), updatedAt });
                  rpcCall(contextId, "update_shadow", { id: el.id, shadow_color: el.shadowColor ?? null, shadow_offset_x: el.shadowOffsetX ?? null, shadow_offset_y: Number(e.target.value), shadow_blur: el.shadowBlur ?? null, updated_at: updatedAt }).catch((e) => reportFailure.current("update_shadow", e));
                }} />
            </div>
          </div>
        )}
      </div>

      {/* Delete */}
      <div className={styles.deleteRow}>
        <button className={styles.deleteBtn} data-testid="delete-element" disabled={readOnly} onClick={() => handleDelete()}>
          Delete element
        </button>
      </div>

    </div>
  );

  return (
    <div className={styles.panel}>
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
