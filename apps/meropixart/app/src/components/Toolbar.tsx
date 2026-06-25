import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import type { Tool } from "../types";
import ColorPicker from "./ColorPicker";
import { ToolIcon, SwapIcon } from "./ToolIcons";
import styles from "./Toolbar.module.css";

interface ToolDef {
  tool: Tool;
  label: string;
}

// Order roughly mirrors the Photoshop tool rail.
const TOOLS: ToolDef[] = [
  { tool: "move", label: "Move (V)" },
  { tool: "marquee", label: "Rectangular Marquee (M)" },
  { tool: "lasso", label: "Lasso (L)" },
  { tool: "crop", label: "Crop (C)" },
  { tool: "brush", label: "Brush (B)" },
  { tool: "eraser", label: "Eraser (E)" },
  { tool: "bucket", label: "Paint Bucket (G)" },
  { tool: "eyedropper", label: "Eyedropper (I)" },
  { tool: "text", label: "Type (T)" },
  { tool: "shape", label: "Shape (U)" },
  { tool: "transform", label: "Transform" },
  { tool: "clone", label: "Clone Stamp (S)" },
  { tool: "hand", label: "Hand (H)" },
  { tool: "zoom", label: "Zoom (Z)" },
];

export default function Toolbar() {
  const activeTool = useEditorStore((s) => s.activeTool);
  const setTool = useEditorStore((s) => s.setTool);
  const primaryColor = useEditorStore((s) => s.primaryColor);
  const secondaryColor = useEditorStore((s) => s.secondaryColor);
  const setPrimaryColor = useEditorStore((s) => s.setPrimaryColor);
  const swapColors = useEditorStore((s) => s.swapColors);

  const [pickerOpen, setPickerOpen] = useState(false);
  // Instant custom tooltip, fixed-positioned beside the hovered button so it
  // is never clipped by the rail's scroll overflow.
  const [tip, setTip] = useState<{ label: string; top: number; left: number } | null>(null);

  const showTip = (label: string) => (e: React.SyntheticEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ label, top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hideTip = () => setTip(null);

  return (
    <div className={styles.rail} data-testid="toolbar">
      <div className={styles.tools}>
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            type="button"
            aria-label={t.label}
            aria-pressed={activeTool === t.tool}
            className={`${styles.tool} ${activeTool === t.tool ? styles.toolActive : ""}`}
            onClick={() => setTool(t.tool)}
            onMouseEnter={showTip(t.label)}
            onMouseLeave={hideTip}
            onFocus={showTip(t.label)}
            onBlur={hideTip}
            data-testid={`tool-${t.tool}`}
          >
            <ToolIcon tool={t.tool} />
          </button>
        ))}
      </div>

      <div className={styles.colorSection}>
        <div className={styles.swatches}>
          <button
            type="button"
            className={`${styles.swatch} ${styles.swatchPrimary}`}
            style={{ backgroundColor: primaryColor }}
            aria-label="Primary color"
            onClick={() => setPickerOpen(true)}
            onMouseEnter={showTip("Primary color")}
            onMouseLeave={hideTip}
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
          aria-label="Swap colors"
          onClick={swapColors}
          onMouseEnter={showTip("Swap colors (X)")}
          onMouseLeave={hideTip}
          data-testid="swap-colors"
        >
          <SwapIcon />
        </button>
      </div>

      {tip && (
        <div
          className={styles.tip}
          role="tooltip"
          style={{ top: tip.top, left: tip.left }}
        >
          {tip.label}
        </div>
      )}

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
