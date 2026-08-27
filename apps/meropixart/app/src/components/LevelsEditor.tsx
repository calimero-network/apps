import { useState } from "react";
import { NEUTRAL_LEVELS, type LevelsData } from "../utils/raster";
import styles from "./LevelsEditor.module.css";

interface Props {
  /** bake the chosen levels into the active raster layer */
  onApply: (levels: LevelsData) => void;
  onClose: () => void;
}

/** Compact Levels dialog — input black/white + gamma, output black/white. */
export default function LevelsEditor({ onApply, onClose }: Props) {
  const [lv, setLv] = useState<LevelsData>({ ...NEUTRAL_LEVELS });
  const patch = (p: Partial<LevelsData>) => setLv((s) => ({ ...s, ...p }));

  return (
    <div className={styles.backdrop} onPointerDown={onClose}>
      <div
        className={`mp-modal ${styles.panel}`}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Levels"
        data-testid="levels-editor"
      >
        <div className={styles.head}>
          <span className="mp-label">Levels</span>
          <button type="button" className={styles.x} aria-label="Close" onClick={onClose}>×</button>
        </div>

        {/* gradient ramp shows the current output range */}
        <div
          className={styles.ramp}
          style={{ background: `linear-gradient(90deg, hsl(0 0% ${(lv.outBlack / 255) * 100}%), hsl(0 0% ${(lv.outWhite / 255) * 100}%))` }}
        />

        <Row label="Input black" min={0} max={254} value={lv.inBlack}
          onChange={(v) => patch({ inBlack: Math.min(v, lv.inWhite - 1) })} testid="levels-in-black" />
        <Row label="Gamma" min={10} max={300} value={Math.round(lv.gamma * 100)}
          display={lv.gamma.toFixed(2)} onChange={(v) => patch({ gamma: v / 100 })} testid="levels-gamma" />
        <Row label="Input white" min={1} max={255} value={lv.inWhite}
          onChange={(v) => patch({ inWhite: Math.max(v, lv.inBlack + 1) })} testid="levels-in-white" />
        <div className={styles.divider} />
        <Row label="Output black" min={0} max={255} value={lv.outBlack}
          onChange={(v) => patch({ outBlack: v })} testid="levels-out-black" />
        <Row label="Output white" min={0} max={255} value={lv.outWhite}
          onChange={(v) => patch({ outWhite: v })} testid="levels-out-white" />

        <div className={styles.footer}>
          <button type="button" className="mp-btn mp-btn--ghost" onClick={() => setLv({ ...NEUTRAL_LEVELS })}>Reset</button>
          <button type="button" className="mp-btn mp-btn--primary" onClick={() => { onApply(lv); onClose(); }} data-testid="levels-apply">Apply</button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, min, max, value, onChange, display, testid }: {
  label: string; min: number; max: number; value: number;
  onChange: (v: number) => void; display?: string; testid?: string;
}) {
  return (
    <label className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input className="mp-range" type="range" min={min} max={max} value={value}
        onChange={(e) => onChange(Number(e.target.value))} data-testid={testid} />
      <span className={styles.val}>{display ?? value}</span>
    </label>
  );
}
