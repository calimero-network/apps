import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import type { Tool } from "../types";
import ColorPicker from "./ColorPicker";
import styles from "./Toolbar.module.css";

interface ToolDef {
  tool: Tool;
  label: string;
  glyph: string; // unicode glyph icon
}

// Order roughly mirrors the Photoshop tool rail.
const TOOLS: ToolDef[] = [
  { tool: "move", label: "Move (V)", glyph: "✛" },
  { tool: "marquee", label: "Rectangular Marquee (M)", glyph: "▢" },
  { tool: "lasso", label: "Lasso (L)", glyph: "✣" },
  { tool: "crop", label: "Crop (C)", glyph: "⌗" },
  { tool: "brush", label: "Brush (B)", glyph: "✎" },
  { tool: "eraser", label: "Eraser (E)", glyph: "⌫" },
  { tool: "bucket", label: "Paint Bucket (G)", glyph: "🪣" },
  { tool: "eyedropper", label: "Eyedropper (I)", glyph: "⚲" },
  { tool: "text", label: "Type (T)", glyph: "T" },
  { tool: "shape", label: "Shape (U)", glyph: "▰" },
  { tool: "gradient", label: "Gradient", glyph: "◧" },
  { tool: "transform", label: "Transform", glyph: "⤢" },
  { tool: "clone", label: "Clone Stamp (S)", glyph: "❏" },
  { tool: "hand", label: "Hand (H)", glyph: "✋" },
  { tool: "zoom", label: "Zoom (Z)", glyph: "🔍" },
];

export default function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const swapColors = useEditorStore((s) => s.swapColors);
  const brushSize = useEditorStore((s) => s.brushSize);
  const brushHardness = useEditorStore((s) => s.brushHardness);
  const brushOpacity = useEditorStore((s) => s.brushOpacity);
  const setBrush = useEditorStore((s) => s.setBrush);

  const [pickerOpen, setPickerOpen] = useState(false);

  const showBrushControls = activeTool === "brush" || activeTool === "eraser";

  return (
    <div className={styles.rail} data-testid="toolbar">
      <div className={styles.tools}>
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            title={t.label}
            aria-label={t.label}
            aria-pressed={activeTool === t.tool}
            className={`${styles.tool} ${activeTool === t.tool ? styles.toolActive : ""}`}
            onClick={() => setTool(t.tool)}
            data-testid={`tool-${t.tool}`}
          >
            <span className={styles.glyph} aria-hidden="true">{t.glyph}</span>
          </button>
        ))}
      </div>

      {showBrushControls && (
        <div className={styles.brushPop} data-testid="brush-controls">
          <label className={styles.brushRow}>
            <span className={styles.brushLabel}>Size</span>
            <input
              type="range"
              className="mp-range"
              min={1}
              max={400}
              value={brushSize}
              onChange={(e) => setBrush({ size: Number(e.target.value) })}
              data-testid="brush-size"
            />
            <span className={styles.brushVal}>{brushSize}</span>
          </label>
          <label className={styles.brushRow}>
            <span className={styles.brushLabel}>Hard</span>
            <input
              type="range"
              className="mp-range"
              min={0}
              max={100}
              value={brushHardness}
              onChange={(e) => setBrush({ hardness: Number(e.target.value) })}
              data-testid="brush-hardness"
            />
            <span className={styles.brushVal}>{brushHardness}</span>
          </label>
          <label className={styles.brushRow}>
            <span className={styles.brushLabel}>Flow</span>
            <input
              type="range"
              className="mp-range"
              min={0}
              max={100}
              value={brushOpacity}
              onChange={(e) => setBrush({ opacity: Number(e.target.value) })}
              data-testid="brush-opacity"
            />
            <span className={styles.brushVal}>{brushOpacity}</span>
          </label>
        </div>
      )}

      <div className={styles.colorSection}>
        <div className={styles.swatches}>
          <button
            type="button"
            className={`${styles.swatch} ${styles.swatchPrimary}`}
            style={{ backgroundColor: primaryColor }}
            title="Primary color"
            aria-label="Primary color"
            onClick={() => setPickerOpen(true)}
            data-testid="primary-swatch"
          />
          <span
            className={`${styles.swatch} ${styles.swatchSecondary}`}
            style={{ backgroundColor: secondaryColor }}
            title="Secondary color"
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          className={styles.swap}
          title="Swap colors (X)"
          aria-label="Swap colors"
          onClick={swapColors}
          data-testid="swap-colors"
        >
          ⇄
        </button>
      </div>

      {pickerOpen && (
        <ColorPicker
          value={primaryColor}
          onChange={setPrimaryColor}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
