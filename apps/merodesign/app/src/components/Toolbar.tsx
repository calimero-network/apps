import { useCanvasStore } from "../store/canvasStore";
import styles from "./Toolbar.module.css";

const TOOLS = [
  { id: "select", label: "V", title: "Select" },
  { id: "rect", label: "R", title: "Rectangle" },
  { id: "circle", label: "O", title: "Circle" },
  { id: "line", label: "L", title: "Line" },
  { id: "arrow", label: "→", title: "Arrow" },
  { id: "path", label: "P", title: "Pen" },
  { id: "text", label: "T", title: "Text" },
  { id: "image", label: "⬚", title: "Image" },
] as const;

interface Props {
  contextId: string;
}

export default function Toolbar({ contextId: _contextId }: Props) {
  const { activeTool, setTool } = useCanvasStore();

  return (
    <div className={styles.bar}>
      <span className={styles.logo}>MeroDesign</span>
      <div className={styles.tools}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tool} ${activeTool === t.id ? styles.active : ""}`}
            title={t.title}
            onClick={() => setTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className={styles.right} />
    </div>
  );
}
