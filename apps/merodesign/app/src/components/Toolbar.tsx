import { useRef } from "react";
import { useCanvasStore, type Background } from "../store/canvasStore";
import { fileToDataUrl } from "../utils/export";
import { getImageDimensions } from "../utils/image";
import styles from "./Toolbar.module.css";

const TOOLS = [
  { id: "select", label: "V", title: "Select (V)" },
  { id: "rect",   label: "R", title: "Rectangle (R)" },
  { id: "circle", label: "O", title: "Circle (O)" },
  { id: "line",   label: "L", title: "Line (L)" },
  { id: "arrow",  label: "→", title: "Arrow" },
  { id: "path",   label: "✏", title: "Pen (P)" },
  { id: "text",   label: "T", title: "Text (T)" },
] as const;

const BG_OPTIONS: { value: Background; label: string; style: string }[] = [
  { value: "#ffffff", label: "W", style: "#ffffff" },
  { value: "#808080", label: "G", style: "#808080" },
  { value: "#111111", label: "B", style: "#111111" },
];

interface Props {
  contextId: string;
  onExportPng: () => void;
  onExportSvg: () => void;
  onImageUpload: (file: File, dataUrl: string, width: number, height: number) => void;
}

export default function Toolbar({ contextId: _contextId, onExportPng, onExportSvg, onImageUpload }: Props) {
  const { activeTool, setTool, background, setBackground } = useCanvasStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const dataUrl = await fileToDataUrl(file);
    const { width, height } = await getImageDimensions(dataUrl);
    onImageUpload(file, dataUrl, width, height);
  }

  return (
    <div className={styles.bar}>
      <span className={styles.logo}>MeroDesign</span>

      <div className={styles.divider} />

      <div className={styles.tools}>
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`${styles.tool} ${activeTool === t.id ? styles.active : ""}`}
            title={t.title}
            onClick={() => setTool(t.id)}
            data-testid={`tool-${t.id}`}
          >
            {t.label}
          </button>
        ))}
        <button
          className={`${styles.tool} ${activeTool === "image" ? styles.active : ""}`}
          title="Image (I)"
          data-testid="tool-image"
          onClick={() => {
            setTool("image");
            fileInputRef.current?.click();
          }}
        >
          ⬚
        </button>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <span className={styles.sectionLabel}>Background</span>
        <div className={styles.bgPicker}>
          {BG_OPTIONS.map((o) => (
            <button
              key={o.value}
              className={`${styles.bgBtn} ${background === o.value ? styles.bgActive : ""}`}
              style={{ background: o.style }}
              title={`Background: ${o.label === "W" ? "White" : o.label === "G" ? "Gray" : "Black"}`}
              data-testid={`bg-${o.label.toLowerCase()}`}
              onClick={() => setBackground(o.value)}
            />
          ))}
        </div>
      </div>

      <div className={styles.divider} />

      <div className={styles.section}>
        <span className={styles.sectionLabel}>Export</span>
        <button className={styles.exportBtn} onClick={onExportPng} title="Export as PNG" data-testid="export-png">
          PNG
        </button>
        <button className={styles.exportBtn} onClick={onExportSvg} title="Export as SVG" data-testid="export-svg">
          SVG
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
        data-testid="image-file-input"
      />
    </div>
  );
}
