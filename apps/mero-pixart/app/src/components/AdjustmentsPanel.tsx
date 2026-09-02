import { useState } from "react";
import { useEditorStore } from "../store/editorStore";
import type { Adjustments, Layer } from "../types";
import { NEUTRAL_ADJUSTMENTS } from "../types";
import type { LevelsData } from "../utils/raster";
import CurvesEditor from "./CurvesEditor";
import LevelsEditor from "./LevelsEditor";
import styles from "./AdjustmentsPanel.module.css";

interface Props {
  layer: Layer | undefined;
  onAdjust: (patch: Partial<Adjustments>) => void;
  onApplyCurves: (curvesJson: string) => void;
  onApplyLevels: (levels: LevelsData) => void;
  disabled: boolean;
}

type NumericField = "brightness" | "contrast" | "saturation" | "hue" | "exposure" | "blur";

interface SliderDef {
  field: NumericField;
  label: string;
  min: number;
  max: number;
}

const SLIDERS: SliderDef[] = [
  { field: "brightness", label: "Brightness", min: -100, max: 100 },
  { field: "contrast", label: "Contrast", min: -100, max: 100 },
  { field: "saturation", label: "Saturation", min: -100, max: 100 },
  { field: "hue", label: "Hue", min: -180, max: 180 },
  { field: "exposure", label: "Exposure", min: -100, max: 100 },
  { field: "blur", label: "Blur", min: 0, max: 100 },
];

interface FilterPreset {
  label: string;
  patch: Partial<Adjustments>;
}

const FILTERS: FilterPreset[] = [
  { label: "Grayscale", patch: { saturation: -100 } },
  { label: "Sepia", patch: { saturation: -60, hue: 30, contrast: 10 } },
  { label: "Blur+", patch: { blur: 4 } },
];

export default function AdjustmentsPanel({ layer, onAdjust, onApplyCurves, onApplyLevels, disabled }: Props) {
  const [curvesOpen, setCurvesOpen] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const collapsed = useEditorStore((s) => s.panelCollapsed.adjustments);
  const toggleCollapsed = useEditorStore((s) => s.togglePanelCollapsed);

  const heading = (
    <button className="mp-collapse" onClick={() => toggleCollapsed("adjustments")}
      aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} Adjustments`}>
      <span className="mp-chev">{collapsed ? "▸" : "▾"}</span>
      <span className="mp-label">Adjustments</span>
    </button>
  );

  if (!layer) {
    return (
      <div className={styles.panel} data-testid="adjustments-panel">
        <div className={styles.headerRow}>{heading}</div>
        {!collapsed && <div className={styles.empty}>Select a layer to adjust.</div>}
      </div>
    );
  }

  const adj = layer.adjustments ?? NEUTRAL_ADJUSTMENTS;

  return (
    <div className={styles.panel} data-testid="adjustments-panel">
      <div className={styles.headerRow}>
        {heading}
        <button
          type="button"
          className="mp-btn mp-btn--ghost"
          onClick={() => onAdjust(NEUTRAL_ADJUSTMENTS)}
          disabled={disabled}
          data-testid="adjustments-reset"
        >
          Reset
        </button>
      </div>

      {collapsed ? null : (<>
      <div className={styles.sliders}>
        {SLIDERS.map((s) => {
          const value = adj[s.field] ?? NEUTRAL_ADJUSTMENTS[s.field];
          return (
            <div className={styles.sliderRow} key={s.field}>
              <div className={styles.sliderHead}>
                <span className={styles.sliderLabel}>{s.label}</span>
                <span className={styles.sliderVal}>{value}</span>
              </div>
              <input
                type="range"
                className="mp-range"
                min={s.min}
                max={s.max}
                value={value}
                disabled={disabled}
                onChange={(e) => onAdjust({ [s.field]: Number(e.target.value) })}
                onDoubleClick={() => onAdjust({ [s.field]: NEUTRAL_ADJUSTMENTS[s.field] })}
                title="Double-click to reset"
                data-testid={`adjust-${s.field}`}
              />
            </div>
          );
        })}
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={adj.invert}
          disabled={disabled}
          onChange={(e) => onAdjust({ invert: e.target.checked })}
          data-testid="adjust-invert"
        />
        <span>Invert colors</span>
      </label>

      <div className={styles.divider} />

      <div className={styles.subHead}>
        <span className="mp-label">Filters</span>
      </div>
      <div className={styles.filters}>
        {FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`mp-btn ${styles.filterBtn}`}
            onClick={() => onAdjust(f.patch)}
            disabled={disabled}
            data-testid={`filter-${f.label.toLowerCase().replace(/\W+/g, "")}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        <button
          type="button"
          className="mp-btn"
          onClick={() => setCurvesOpen(true)}
          disabled={disabled}
          data-testid="open-curves"
        >
          Curves…
        </button>
        <button
          type="button"
          className="mp-btn"
          onClick={() => setLevelsOpen(true)}
          disabled={disabled}
          data-testid="open-levels"
        >
          Levels…
        </button>
      </div>

      {curvesOpen && (
        <CurvesEditor
          initial={adj.curves}
          onApply={onApplyCurves}
          onClose={() => setCurvesOpen(false)}
        />
      )}

      {levelsOpen && (
        <LevelsEditor
          onApply={onApplyLevels}
          onClose={() => setLevelsOpen(false)}
        />
      )}
      </>)}
    </div>
  );
}
