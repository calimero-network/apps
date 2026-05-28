import { useCanvasStore } from "../store/canvasStore";
import styles from "./PropertiesPanel.module.css";

interface Props {
  contextId: string;
}

export default function PropertiesPanel({ contextId: _contextId }: Props) {
  const { selectedElementId, elements } = useCanvasStore();
  const el = elements.find((e) => e.id === selectedElementId);

  if (!el) {
    return (
      <div className={styles.panel}>
        <p className={styles.hint}>Select an element to edit its properties.</p>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <p className={styles.section}>Element</p>

      <label className={styles.label}>Kind</label>
      <p className={styles.value}>{el.data.kind}</p>

      <label className={styles.label}>Position</label>
      <p className={styles.value}>x: {el.x}  y: {el.y}</p>

      <label className={styles.label}>Size</label>
      <p className={styles.value}>{el.width} × {el.height}</p>

      <label className={styles.label}>Rotation</label>
      <p className={styles.value}>{el.rotation}°</p>

      <label className={styles.label}>Fill</label>
      <div className={styles.colorRow}>
        <span className={styles.swatch} style={{ background: el.fill || "#fff" }} />
        <span className={styles.value}>{el.fill || "—"}</span>
      </div>

      <label className={styles.label}>Stroke</label>
      <div className={styles.colorRow}>
        <span className={styles.swatch} style={{ background: el.stroke || "transparent", border: "1px solid #ccc" }} />
        <span className={styles.value}>{el.stroke || "—"}</span>
      </div>

      <label className={styles.label}>Opacity</label>
      <p className={styles.value}>{el.opacity}%</p>
    </div>
  );
}
