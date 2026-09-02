import { useEditorStore } from "../store/editorStore";
import { usePointerStore } from "../store/pointerStore";
import type { Selection, Unit } from "../types";
import { UNITS } from "../types";
import styles from "./StatusBar.module.css";

// CSS reference: 96 px per inch. Percent is relative to the document dimension.
function toUnit(px: number, unit: Unit, docDim: number): string {
  switch (unit) {
    case "in": return (px / 96).toFixed(2);
    case "cm": return (px / 96 * 2.54).toFixed(2);
    case "mm": return (px / 96 * 25.4).toFixed(1);
    case "percent": return (px / Math.max(1, docDim) * 100).toFixed(1);
    default: return String(Math.round(px));
  }
}

export default function StatusBar() {
  const zoom = useEditorStore((s) => s.zoom);
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const unit = useEditorStore((s) => s.view.units);
  const x = usePointerStore((s) => s.x);
  const y = usePointerStore((s) => s.y);
  const color = usePointerStore((s) => s.color);

  const sel = selBounds(selection);
  const abbr = UNITS.find((u) => u.unit === unit)?.abbr ?? "px";
  const dw = doc?.width ?? 1;
  const dh = doc?.height ?? 1;

  return (
    <div className={styles.bar} data-testid="status-bar">
      <span className={styles.item} title="Zoom">{Math.round(zoom * 100)}%</span>
      <span className={styles.sep} />
      <span className={styles.item}>X: {x != null ? toUnit(x, unit, dw) : "—"}</span>
      <span className={styles.item}>Y: {y != null ? toUnit(y, unit, dh) : "—"}</span>
      <span className={styles.item}>{abbr}</span>
      <span className={styles.sep} />
      <span className={styles.item} title="Color under cursor">
        <span className={styles.swatch} style={{ backgroundColor: color ?? "transparent" }} />
        {color ?? "—"}
      </span>
      <span className={styles.sep} />
      <span className={styles.item} title="Selection size">
        Sel: {sel ? `${sel.w} × ${sel.h}` : "—"}
      </span>
      <span className={styles.grow} />
      <span className={styles.item} title="Document size">
        {doc ? `${doc.width} × ${doc.height} px` : ""}
      </span>
    </div>
  );
}

function selBounds(sel: Selection | null): { w: number; h: number } | null {
  if (!sel) return null;
  if (sel.kind === "rect") return { w: Math.round(sel.w), h: Math.round(sel.h) };
  const pts = sel.points;
  if (pts.length < 4) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
}
