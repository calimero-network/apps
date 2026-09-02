import { useEditorStore } from "../store/editorStore";
import { boundsOf, isNeutralWarp, serializeWarp, warpOf } from "../utils/transform";
import {
  presetCorners, wrapAngle, WARP_PRESETS, WARP_PRESET_LABEL, type WarpPreset,
} from "../utils/warpPresets";
import { NEUTRAL_WARP, type Layer, type WarpCorners } from "../types";
import { Icon } from "./ToolIcons";
import styles from "./TransformPanel.module.css";

interface Props {
  layer?: Layer;
  /** Persist a transform patch (rotation / skew / mirror / warp) on a layer. */
  onTransform: (id: string, patch: Partial<Layer>) => void;
  /** Move a layer to an absolute document position. */
  onMove: (id: string, x: number, y: number) => void;
  /** Bake the live transform into pixels, leaving an upright raster layer. */
  onApplyTransform: (id: string) => void;
  disabled?: boolean;
}

/**
 * Numeric free-transform controls for the selected layer.
 *
 * The canvas gizmo is for eyeballing; this panel is for saying exactly 90°, or
 * nudging one warp corner by two pixels. Both write the same contract fields
 * through `update_transform`, so the two are never out of step.
 *
 * Size is deliberately absent — the scale handles on the canvas already own it.
 */
export default function TransformPanel({
  layer, onTransform, onMove, onApplyTransform, disabled,
}: Props) {
  const collapsed = useEditorStore((s) => s.panelCollapsed.transform);
  const togglePanelCollapsed = useEditorStore((s) => s.togglePanelCollapsed);
  const transformMode = useEditorStore((s) => s.transformMode);
  const setTransformMode = useEditorStore((s) => s.setTransformMode);
  const setTool = useEditorStore((s) => s.setTool);
  const activeTool = useEditorStore((s) => s.activeTool);

  const ro = disabled || !layer;
  const warp = layer ? warpOf(layer) : NEUTRAL_WARP;
  const warped = !isNeutralWarp(warp);
  const bounds = layer ? boundsOf(layer) : null;

  const patchWarp = (corner: keyof WarpCorners, axis: 0 | 1, value: number) => {
    if (!layer) return;
    const next: WarpCorners = {
      tl: [...warp.tl] as [number, number],
      tr: [...warp.tr] as [number, number],
      br: [...warp.br] as [number, number],
      bl: [...warp.bl] as [number, number],
    };
    next[corner][axis] = Math.round(value);
    onTransform(layer.id, { warp: serializeWarp(next) });
  };

  const applyPreset = (preset: WarpPreset) => {
    if (!layer) return;
    onTransform(layer.id, { warp: serializeWarp(presetCorners(preset, layer)) });
  };

  return (
    <div className={styles.panel} data-testid="transform-panel">
      <div className={styles.header}>
        <button className="mp-collapse" onClick={() => togglePanelCollapsed("transform")}
          aria-expanded={!collapsed} aria-label={`${collapsed ? "Expand" : "Collapse"} Transform`}>
          <span className="mp-chev">{collapsed ? "▸" : "▾"}</span>
          <span className="mp-label">Transform</span>
        </button>
        {layer && <span className={styles.target} title={layer.name}>{layer.name}</span>}
      </div>

      {!collapsed && (
        <div className={styles.body}>
          {!layer && <p className={styles.empty}>Select a layer to transform it.</p>}

          {layer && (
            <>
              <div className={styles.grid2}>
                <Num label="X" value={Math.round(layer.x)} disabled={ro} testId="transform-x"
                  onChange={(v) => onMove(layer.id, v, layer.y)} />
                <Num label="Y" value={Math.round(layer.y)} disabled={ro} testId="transform-y"
                  onChange={(v) => onMove(layer.id, layer.x, v)} />
              </div>

              <Row label="Angle">
                <input
                  className="mp-range"
                  type="range" min={-180} max={180} step={1}
                  value={layer.rotation}
                  disabled={ro}
                  aria-label="Rotation"
                  data-testid="transform-rotation-range"
                  onChange={(e) => onTransform(layer.id, { rotation: Number(e.target.value) })}
                />
                <NumBox value={layer.rotation} suffix="°" disabled={ro} testId="transform-rotation"
                  min={-180} max={180}
                  onChange={(v) => onTransform(layer.id, { rotation: v })} />
              </Row>

              <div className={styles.btnRow}>
                <button type="button" disabled={ro} data-testid="rotate-ccw"
                  title="Rotate 90° counter-clockwise" aria-label="Rotate 90 degrees counter-clockwise"
                  onClick={() => onTransform(layer.id, { rotation: wrapAngle(layer.rotation - 90) })}>
                  <span className={styles.mirrored}><Icon name="rotate" size={14} /></span> 90°
                </button>
                <button type="button" disabled={ro} data-testid="rotate-cw"
                  title="Rotate 90° clockwise" aria-label="Rotate 90 degrees clockwise"
                  onClick={() => onTransform(layer.id, { rotation: wrapAngle(layer.rotation + 90) })}>
                  <Icon name="rotate" size={14} /> 90°
                </button>
                <button type="button" disabled={ro} data-testid="flip-h"
                  className={layer.flipH ? styles.on : ""}
                  title="Flip horizontal" aria-label="Flip horizontal"
                  aria-pressed={layer.flipH}
                  onClick={() => onTransform(layer.id, { flipH: !layer.flipH })}>
                  <Icon name="flipH" size={14} />
                </button>
                <button type="button" disabled={ro} data-testid="flip-v"
                  className={layer.flipV ? styles.on : ""}
                  title="Flip vertical" aria-label="Flip vertical"
                  aria-pressed={layer.flipV}
                  onClick={() => onTransform(layer.id, { flipV: !layer.flipV })}>
                  <Icon name="flipV" size={14} />
                </button>
              </div>

              <Row label="Skew X">
                <input
                  className="mp-range"
                  type="range" min={-80} max={80} step={1}
                  value={layer.skewX}
                  disabled={ro}
                  aria-label="Skew horizontally"
                  data-testid="transform-skewx-range"
                  onChange={(e) => onTransform(layer.id, { skewX: Number(e.target.value) })}
                />
                <NumBox value={layer.skewX} suffix="°" disabled={ro} testId="transform-skewx"
                  min={-80} max={80}
                  onChange={(v) => onTransform(layer.id, { skewX: v })} />
              </Row>
              <Row label="Skew Y">
                <input
                  className="mp-range"
                  type="range" min={-80} max={80} step={1}
                  value={layer.skewY}
                  disabled={ro}
                  aria-label="Skew vertically"
                  data-testid="transform-skewy-range"
                  onChange={(e) => onTransform(layer.id, { skewY: Number(e.target.value) })}
                />
                <NumBox value={layer.skewY} suffix="°" disabled={ro} testId="transform-skewy"
                  min={-80} max={80}
                  onChange={(v) => onTransform(layer.id, { skewY: v })} />
              </Row>

              {/* ── Warp ─────────────────────────────────────────────────── */}
              <div className={styles.sectionHead}>
                <span>Warp</span>
                <button
                  type="button"
                  className={`${styles.pinBtn} ${activeTool === "transform" && transformMode === "warp" ? styles.on : ""}`}
                  disabled={ro}
                  data-testid="warp-mode-toggle"
                  aria-pressed={activeTool === "transform" && transformMode === "warp"}
                  title="Drag the four corner pins on the canvas"
                  onClick={() => {
                    const on = activeTool === "transform" && transformMode === "warp";
                    setTransformMode(on ? "free" : "warp");
                    if (!on) setTool("transform");
                  }}
                >
                  <Icon name="warp" size={14} /> Pins
                </button>
              </div>

              <div className={styles.presets}>
                {WARP_PRESETS.map((p) => (
                  <button key={p} type="button" disabled={ro}
                    data-testid={`warp-preset-${p}`}
                    onClick={() => applyPreset(p)}>{WARP_PRESET_LABEL[p]}</button>
                ))}
                <button type="button" disabled={ro || !warped} data-testid="warp-reset"
                  onClick={() => onTransform(layer.id, { warp: "" })}>None</button>
              </div>

              <div className={styles.corners} data-testid="warp-corners">
                {(["tl", "tr", "bl", "br"] as const).map((corner) => (
                  <div key={corner} className={styles.corner}>
                    <span className={styles.cornerLabel}>{CORNER_LABEL[corner]}</span>
                    <NumBox value={warp[corner][0]} disabled={ro} testId={`warp-${corner}-x`}
                      min={-4096} max={4096}
                      onChange={(v) => patchWarp(corner, 0, v)} />
                    <NumBox value={warp[corner][1]} disabled={ro} testId={`warp-${corner}-y`}
                      min={-4096} max={4096}
                      onChange={(v) => patchWarp(corner, 1, v)} />
                  </div>
                ))}
              </div>

              {bounds && (
                <p className={styles.readout} data-testid="transform-bounds">
                  Bounds {Math.round(bounds.w)} × {Math.round(bounds.h)} px
                </p>
              )}

              <div className={styles.footer}>
                <button
                  type="button"
                  className="mp-btn mp-btn--ghost"
                  disabled={ro}
                  data-testid="transform-reset"
                  onClick={() => onTransform(layer.id, {
                    rotation: 0, skewX: 0, skewY: 0, flipH: false, flipV: false,
                    scaleX: 100, scaleY: 100, warp: "",
                  })}
                >
                  <Icon name="reset" size={14} /> Reset
                </button>
                <button
                  type="button"
                  className="mp-btn"
                  disabled={ro || layer.kind !== "raster"}
                  title={layer.kind === "raster"
                    ? "Bake the transform into the layer's pixels"
                    : "Only raster layers can be baked"}
                  data-testid="transform-apply"
                  onClick={() => onApplyTransform(layer.id)}
                >
                  Apply
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const CORNER_LABEL: Record<keyof WarpCorners, string> = {
  tl: "↖", tr: "↗", bl: "↙", br: "↘",
};

// ── Small controls ───────────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

function Num({ label, value, onChange, disabled, testId }: {
  label: string; value: number; onChange: (v: number) => void;
  disabled?: boolean; testId?: string;
}) {
  return (
    <label className={styles.numField}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.num}
        type="number"
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.round(v));
        }}
      />
    </label>
  );
}

function NumBox({ value, onChange, disabled, suffix, min, max, testId }: {
  value: number; onChange: (v: number) => void; disabled?: boolean;
  suffix?: string; min: number; max: number; testId?: string;
}) {
  return (
    <span className={styles.numBox}>
      <input
        className={styles.num}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        data-testid={testId}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, Math.round(v))));
        }}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </span>
  );
}
