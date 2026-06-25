import { useEditorStore } from "../store/editorStore";
import { usePointerStore } from "../store/pointerStore";
import type { Selection } from "../types";
import styles from "./StatusBar.module.css";

export default function StatusBar() {
  const zoom = useEditorStore((s) => s.zoom);
  const doc = useEditorStore((s) => s.doc);
  const selection = useEditorStore((s) => s.selection);
  const x = usePointerStore((s) => s.x);
  const y = usePointerStore((s) => s.y);

  const sel = selBounds(selection);

  return (
    <div className={styles.bar} data-testid="status-bar">
      <span className={styles.item} title="Zoom">{Math.round(zoom * 100)}%</span>
      <span className={styles.sep} />
      <span className={styles.item}>X: {x != null ? Math.round(x) : "—"}</span>
      <span className={styles.item}>Y: {y != null ? Math.round(y) : "—"}</span>
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
