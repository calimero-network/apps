import { rpcCall } from "../api/rpc";
import { useCanvasStore } from "../store/canvasStore";
import styles from "./PropertiesPanel.module.css";

interface Props {
  contextId: string;
}

export default function PropertiesPanel({ contextId }: Props) {
  const { selectedElementId, elements, upsertElement, removeElement } = useCanvasStore();
  const el = elements.find((e) => e.id === selectedElementId);

  async function update(patch: Record<string, unknown>) {
    if (!el) return;
    const updated = { ...el, ...patch, updatedAt: Date.now() };
    upsertElement(updated);
    await rpcCall(contextId, "update_element", {
      id: el.id,
      x: null,
      y: null,
      width: null,
      height: null,
      rotation: null,
      fill: null,
      stroke: null,
      stroke_width: null,
      opacity: null,
      updated_at: updated.updatedAt,
      ...Object.fromEntries(
        Object.entries(patch).map(([k, v]) => [toSnake(k), v]),
      ),
    }).catch(() => {});
  }

  async function handleDelete() {
    if (!el) return;
    removeElement(el.id);
    await rpcCall(contextId, "delete_element", { id: el.id }).catch(() => {});
  }

  async function handleBringToFront() {
    if (!el) return;
    await rpcCall(contextId, "bring_to_front", { id: el.id }).catch(() => {});
  }

  async function handleSendToBack() {
    if (!el) return;
    await rpcCall(contextId, "send_to_back", { id: el.id }).catch(() => {});
  }

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
      <p className={styles.value}>x: {el.x} &nbsp; y: {el.y}</p>

      <label className={styles.label}>Size</label>
      <p className={styles.value}>{el.width} × {el.height}</p>

      <label className={styles.label}>Rotation</label>
      <p className={styles.value}>{el.rotation}°</p>

      <div className={styles.divider} />
      <p className={styles.section}>Style</p>

      <label className={styles.label}>Fill</label>
      <div className={styles.colorRow}>
        <input
          type="color"
          className={styles.colorInput}
          value={el.fill || "#ffffff"}
          data-testid="fill-color"
          onChange={(e) => update({ fill: e.target.value })}
        />
        <span className={styles.value}>{el.fill || "—"}</span>
      </div>

      <label className={styles.label}>Stroke</label>
      <div className={styles.colorRow}>
        <input
          type="color"
          className={styles.colorInput}
          value={el.stroke || "#000000"}
          data-testid="stroke-color"
          onChange={(e) => update({ stroke: e.target.value })}
        />
        <span className={styles.value}>{el.stroke || "—"}</span>
      </div>

      <label className={styles.label}>Opacity: {el.opacity}%</label>
      <input
        type="range"
        min={0}
        max={100}
        value={el.opacity}
        className={styles.slider}
        data-testid="opacity-slider"
        onChange={(e) => update({ opacity: Number(e.target.value) })}
      />

      <div className={styles.divider} />
      <p className={styles.section}>Layer</p>

      <div className={styles.btnRow}>
        <button
          className={styles.btn}
          title="Bring to Front"
          data-testid="bring-to-front"
          onClick={handleBringToFront}
        >
          Bring Front
        </button>
        <button
          className={styles.btn}
          title="Send to Back"
          data-testid="send-to-back"
          onClick={handleSendToBack}
        >
          Send Back
        </button>
      </div>

      <div className={styles.divider} />

      <button
        className={`${styles.btn} ${styles.btnDanger}`}
        data-testid="delete-element"
        onClick={handleDelete}
      >
        Delete element
      </button>
    </div>
  );
}

function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
