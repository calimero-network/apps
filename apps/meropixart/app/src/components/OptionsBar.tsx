import { useEditorStore } from "../store/editorStore";
import { BRUSH_TYPES, SHAPE_KINDS, type TextProps } from "../types";
import styles from "./OptionsBar.module.css";

interface Props {
  /** patch the selected text layer's typography */
  onUpdateText: (id: string, patch: Partial<TextProps>) => void;
}

/** Photoshop-style contextual options bar — controls for the active tool. */
export default function OptionsBar({ onUpdateText }: Props) {
  const s = useEditorStore();
  const { activeTool } = s;
  const sel = s.layers.find((l) => l.id === s.selectedLayerId);

  return (
    <div className={styles.bar} data-testid="options-bar">
      {(activeTool === "brush" || activeTool === "eraser") && (
        <>
          <span className={styles.toolName}>{activeTool === "brush" ? "Brush" : "Eraser"}</span>
          <Field label="Tip">
            <select className={styles.select} value={s.brushType}
              onChange={(e) => s.setBrush({ type: e.target.value as never })}>
              {BRUSH_TYPES.map((b) => <option key={b.type} value={b.type}>{b.label}</option>)}
            </select>
          </Field>
          <Slider label="Size" min={1} max={400} value={s.brushSize} suffix="px"
            onChange={(v) => s.setBrush({ size: v })} />
          {s.brushType === "soft" && (
            <Slider label="Hardness" min={0} max={100} value={s.brushHardness}
              onChange={(v) => s.setBrush({ hardness: v })} />
          )}
          <Slider label="Opacity" min={1} max={100} value={s.brushOpacity}
            onChange={(v) => s.setBrush({ opacity: v })} />
        </>
      )}

      {activeTool === "shape" && (
        <>
          <span className={styles.toolName}>Shape</span>
          <Field label="Type">
            <select className={styles.select} value={s.shapeKind}
              onChange={(e) => s.setShapeKind(e.target.value as never)}>
              {SHAPE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Style">
            <div className={styles.segmented}>
              <button className={!s.shapeStroke ? styles.segOn : ""} onClick={() => s.setShapeStroke(false)}>Fill</button>
              <button className={s.shapeStroke ? styles.segOn : ""} onClick={() => s.setShapeStroke(true)}>Stroke</button>
            </div>
          </Field>
          {(s.shapeStroke || s.shapeKind === "line") && (
            <Slider label="Weight" min={1} max={200} value={s.brushSize} suffix="px"
              onChange={(v) => s.setBrush({ size: v })} />
          )}
          <span className={styles.note}>Uses the foreground color.</span>
        </>
      )}

      {activeTool === "gradient" && (
        <>
          <span className={styles.toolName}>Gradient</span>
          <Field label="Type">
            <div className={styles.segmented}>
              <button className={s.gradientType === "linear" ? styles.segOn : ""} onClick={() => s.setGradientType("linear")}>Linear</button>
              <button className={s.gradientType === "radial" ? styles.segOn : ""} onClick={() => s.setGradientType("radial")}>Radial</button>
            </div>
          </Field>
          <Field label="Fill">
            <div className={styles.segmented}>
              <button className={s.gradientFill === "fg-transparent" ? styles.segOn : ""} onClick={() => s.setGradientFill("fg-transparent")}>FG→Transparent</button>
              <button className={s.gradientFill === "fg-bg" ? styles.segOn : ""} onClick={() => s.setGradientFill("fg-bg")}>FG→BG</button>
            </div>
          </Field>
          <span className={styles.note}>Drag on the canvas to set direction.</span>
        </>
      )}

      {(activeTool === "marquee" || activeTool === "lasso") && (
        <>
          <span className={styles.toolName}>{activeTool === "marquee" ? "Rectangular Marquee" : "Lasso"}</span>
          <button className={styles.btn} onClick={() => {
            const d = s.doc; if (d) s.setSelection({ kind: "rect", x: 0, y: 0, w: d.width, h: d.height });
          }}>Select All</button>
          <button className={styles.btn} disabled={!s.selection} onClick={() => s.setSelection(null)}>Deselect</button>
          {s.selection && <span className={styles.note}>Selection active — paint/fill is clipped to it.</span>}
        </>
      )}

      {activeTool === "clone" && (
        <>
          <span className={styles.toolName}>Clone Stamp</span>
          <Slider label="Size" min={1} max={400} value={s.brushSize} suffix="px"
            onChange={(v) => s.setBrush({ size: v })} />
          <span className={styles.note}>Alt/⌘-click sets the source.</span>
        </>
      )}

      {activeTool === "text" && sel?.kind === "text" && sel.text && (
        <>
          <span className={styles.toolName}>Type</span>
          <Slider label="Size" min={6} max={400} value={sel.text.fontSize} suffix="px"
            onChange={(v) => onUpdateText(sel.id, { fontSize: v })} />
          <Field label="Color">
            <input className={styles.color} type="color" value={toHex(sel.text.color)}
              onChange={(e) => onUpdateText(sel.id, { color: e.target.value })} />
          </Field>
          <button className={`${styles.btn} ${sel.text.bold ? styles.segOn : ""}`} onClick={() => onUpdateText(sel.id, { bold: !sel.text!.bold })}><b>B</b></button>
          <button className={`${styles.btn} ${sel.text.italic ? styles.segOn : ""}`} onClick={() => onUpdateText(sel.id, { italic: !sel.text!.italic })}><i>I</i></button>
          <Field label="Align">
            <select className={styles.select} value={sel.text.align || "left"}
              onChange={(e) => onUpdateText(sel.id, { align: e.target.value })}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </Field>
        </>
      )}

      {(activeTool === "move" || activeTool === "transform" || activeTool === "hand"
        || activeTool === "zoom" || activeTool === "eyedropper" || activeTool === "bucket"
        || activeTool === "crop"
        || (activeTool === "text" && sel?.kind !== "text")) && (
        <span className={styles.toolName}>{TOOL_HINT[activeTool]}</span>
      )}
    </div>
  );
}

const TOOL_HINT: Record<string, string> = {
  move: "Move — drag the selected layer",
  transform: "Transform — drag handles to scale, the top knob to rotate",
  hand: "Hand — drag to pan",
  zoom: "Zoom — click to zoom in, Alt/⌘-click to zoom out",
  eyedropper: "Eyedropper — click to sample a color",
  bucket: "Paint Bucket — click to fill",
  crop: "Crop — drag a region, then Apply",
  text: "Type — click on the canvas to add text",
};

function toHex(c: string): string {
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) return c;
  return "#000000";
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  );
}

function Slider({ label, min, max, value, suffix, onChange }: {
  label: string; min: number; max: number; value: number; suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      <input className={`mp-range ${styles.range}`} type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} />
      <span className={styles.value}>{value}{suffix ?? ""}</span>
    </label>
  );
}
