import { useEffect, useRef, useState } from "react";
import { useCanvasStore, type Background } from "../store/canvasStore";
import { fileToDataUrl } from "../utils/export";
import { getImageDimensions } from "../utils/image";
import Logo from "./Logo";
import styles from "./Toolbar.module.css";
import type { CursorState } from "../types";
import type { ProjectSnapshot } from "../utils/projectFile";

/* ── SVG tool icons ────────────────────────────────────────────── */
const IconCursor = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
    <path d="M3.5 1.5v11l2.8-2.8 2 4 1.6-.8-2-4H11z"/>
  </svg>
);
const IconHand = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 7V3.5a1 1 0 0 1 2 0V7m0 0V3a1 1 0 0 1 2 0v4m0 0V4.5a1 1 0 0 1 2 0V9c0 2.5-1.5 5-4 5s-4-2-4-4V6a1 1 0 0 1 2 0v1"/>
  </svg>
);
const IconRect = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);
const IconCircle = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5"/>
  </svg>
);
const IconLine = () => (
  <svg viewBox="0 0 16 16" width="14" height="14">
    <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const IconArrow = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="13" x2="12" y2="4"/>
    <polyline points="7,4 12,4 12,9"/>
  </svg>
);
const IconPen = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.5 2L14 4.5 5.5 13H3v-2.5z"/>
    <line x1="9.5" y1="4" x2="12" y2="6.5"/>
  </svg>
);
const IconText = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
    <path d="M3 3h10v2.5H9.5V13h-3V5.5H3z"/>
  </svg>
);
const IconImage = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="1.5" y="3" width="13" height="10" rx="1"/>
    <circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/>
    <polyline points="1.5,11 5,7.5 7.5,10 10.5,7 14.5,11"/>
  </svg>
);
const IconComment = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 2.5h12v8H9.5L7 13V10.5H2z"/>
  </svg>
);
const IconMembers = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="5" r="2.5"/>
    <path d="M1 13c0-2.5 2-4 5-4s5 1.5 5 4"/>
    <circle cx="12" cy="5" r="1.8"/>
    <path d="M12 9.5c1.5.3 2.5 1.5 2.5 3.5"/>
  </svg>
);

const TOOLS = [
  { id: "select" as const, title: "Select (V)", Icon: IconCursor },
  { id: "hand"   as const, title: "Hand / Pan (H)", Icon: IconHand },
  { id: "rect"   as const, title: "Rectangle (R)", Icon: IconRect },
  { id: "circle" as const, title: "Circle (O)", Icon: IconCircle },
  { id: "line"   as const, title: "Line (L)", Icon: IconLine },
  { id: "arrow"  as const, title: "Arrow", Icon: IconArrow },
  { id: "path"   as const, title: "Pen (P)", Icon: IconPen },
  { id: "text"   as const, title: "Text (T)", Icon: IconText },
];

const BG_OPTIONS: { value: Background; label: string; testId: string }[] = [
  { value: "#ffffff", label: "White", testId: "bg-w" },
  { value: "#808080", label: "Gray",  testId: "bg-g" },
  { value: "#111111", label: "Black", testId: "bg-b" },
];

const CURSOR_COLORS = [
  "#e74c3c", "#2ecc71", "#3498db", "#9b59b6",
  "#f39c12", "#1abc9c", "#e67e22", "#e91e63",
];
function colorForIdentity(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}
function shortLabel(id: string) {
  if (id.length <= 10) return id;
  return id.slice(0, 4) + "…" + id.slice(-4);
}

interface Props {
  contextId: string;
  onBack: () => void;
  onLogout: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  onPreview: () => void;
  addingComment?: boolean;
  onToggleComment?: () => void;
  onImageUpload: (file: File, dataUrl: string, width: number, height: number) => void;
  members?: CursorState[];
  onSaveProject?: () => void;
  onImportProject?: (snapshot: ProjectSnapshot) => void;
  /** Viewer (no editor/admin role): hide creation tools + commenting. */
  readOnly?: boolean;
}

export default function Toolbar({
  contextId: _contextId,
  onBack, onLogout,
  onExportPng, onExportSvg,
  onPreview,
  onImageUpload,
  addingComment = false,
  onToggleComment,
  members = [],
  onSaveProject,
  onImportProject,
  readOnly = false,
}: Props) {
  const { activeTool, setTool, background, setBackground, undo, redo, undoStack, redoStack } = useCanvasStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Close options on outside click
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) {
        setOptionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const dataUrl = await fileToDataUrl(file);
    const { width, height } = await getImageDimensions(dataUrl);
    onImageUpload(file, dataUrl, width, height);
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !onImportProject) return;
    e.target.value = "";
    setImportError(null);
    const text = await file.text().catch(() => "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setImportError("Invalid file: not valid JSON");
      return;
    }
    // Inline validation to avoid circular import issues in Toolbar
    const d = parsed as Record<string, unknown>;
    if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.elements) || !Array.isArray(d.comments)) {
      setImportError("Unrecognized project file format or version");
      return;
    }
    if (!window.confirm("This will replace all elements and comments. Continue?")) return;
    onImportProject(parsed as import("../utils/projectFile").ProjectSnapshot);
  }

  return (
    <div className={styles.bar}>
      <button className={styles.backBtn} onClick={onBack} title="Back to projects">←</button>
      <span className={styles.logo}><Logo size={20} /> MeroDesign</span>

      <div className={styles.divider} />

      <div className={styles.tools}>
        {TOOLS.map(({ id, title, Icon }) => {
          // Viewers keep navigation (select/hand) but lose every creation tool.
          const navOnly = id === "select" || id === "hand";
          return (
            <button
              key={id}
              className={`${styles.tool} ${activeTool === id ? styles.active : ""}`}
              title={title}
              onClick={() => setTool(id)}
              data-testid={`tool-${id}`}
              disabled={readOnly && !navOnly}
            >
              <Icon />
            </button>
          );
        })}
        <button
          className={`${styles.tool} ${activeTool === "image" ? styles.active : ""}`}
          title="Image (I)"
          data-testid="tool-image"
          onClick={() => { setTool("image"); fileInputRef.current?.click(); }}
          disabled={readOnly}
        >
          <IconImage />
        </button>
      </div>

      <div className={styles.divider} />

      {/* Options dropdown */}
      <div className={styles.optionsWrap} ref={optionsRef}>
        <button
          className={`${styles.exportBtn} ${optionsOpen ? styles.exportBtnActive : ""}`}
          onClick={() => setOptionsOpen((v) => !v)}
          data-testid="options-btn"
          title="Options"
        >
          Options ▾
        </button>
        {optionsOpen && (
          <div className={styles.optionsDropdown} data-testid="options-dropdown">
            <p className={styles.optionsGroupLabel}>Background</p>
            <div className={styles.optionsBgRow}>
              {BG_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  className={`${styles.bgBtn} ${background === o.value ? styles.bgActive : ""}`}
                  style={{ background: o.value, boxShadow: o.value === "#ffffff" ? "inset 0 0 0 1px #ccc" : undefined }}
                  title={`Background: ${o.label}`}
                  data-testid={o.testId}
                  onClick={() => { setBackground(o.value); setOptionsOpen(false); }}
                />
              ))}
            </div>
            <div className={styles.optionsDivider} />
            <p className={styles.optionsGroupLabel}>Export</p>
            <button className={styles.optionsItem} onClick={() => { onExportPng(); setOptionsOpen(false); }} data-testid="export-png">Export PNG</button>
            <button className={styles.optionsItem} onClick={() => { onExportSvg(); setOptionsOpen(false); }} data-testid="export-svg">Export SVG</button>
            {onSaveProject && (
              <>
                <div className={styles.optionsDivider} />
                <p className={styles.optionsGroupLabel}>File</p>
                <button className={styles.optionsItem} onClick={() => { onSaveProject(); setOptionsOpen(false); }} data-testid="save-project">Save (.merodesign)</button>
                <button className={styles.optionsItem} onClick={() => { importFileInputRef.current?.click(); setOptionsOpen(false); }} data-testid="open-project">Open (.merodesign)</button>
              </>
            )}
            <div className={styles.optionsDivider} />
            <p className={styles.optionsGroupLabel}>History</p>
            <button
              className={styles.optionsItem}
              onClick={() => { undo(); setOptionsOpen(false); }}
              data-testid="undo-btn"
              disabled={readOnly || undoStack.length === 0}
            >Undo (Ctrl+Z)</button>
            <button
              className={styles.optionsItem}
              onClick={() => { redo(); setOptionsOpen(false); }}
              data-testid="redo-btn"
              disabled={readOnly || redoStack.length === 0}
            >Redo (Ctrl+Y)</button>
            {importError && <p className={styles.optionsError}>{importError}</p>}
          </div>
        )}
      </div>

      <div className={styles.spacer} />

      {/* Members online */}
      <div className={styles.membersWrap}>
        <button
          className={styles.membersBtn}
          onClick={() => setMembersOpen((v) => !v)}
          title="Online members"
        >
          <IconMembers />
          {members.length > 0 && (
            <span className={styles.membersBadge}>{members.length}</span>
          )}
        </button>
        {membersOpen && (
          <div className={styles.membersDropdown}>
            <p className={styles.membersTitle}>Online now</p>
            {members.length === 0 ? (
              <p className={styles.membersEmpty}>Only you</p>
            ) : (
              members.map((m) => (
                <div key={m.identity} className={styles.memberRow}>
                  <span
                    className={styles.memberDot}
                    style={{ background: colorForIdentity(m.identity) }}
                  />
                  <span className={styles.memberLabel}>{shortLabel(m.identity)}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {readOnly && (
        <span
          data-testid="view-only-badge"
          title="You have view-only access to this board"
          style={{
            marginRight: 8, padding: "2px 8px", borderRadius: 4,
            fontSize: 12, fontWeight: 600, color: "#92400e",
            background: "#fef3c7", whiteSpace: "nowrap",
          }}
        >
          View only
        </span>
      )}
      {onToggleComment && !readOnly && (
        <button
          className={`${styles.iconBtn} ${addingComment ? styles.iconBtnActive : ""}`}
          onClick={onToggleComment}
          title="Add comment (click canvas to place)"
          style={{ marginRight: 4 }}
        >
          <IconComment />
        </button>
      )}
      <button className={styles.previewBtn} onClick={onPreview} title="Preview canvas (Esc to exit)">
        Preview
      </button>

      <div className={styles.divider} />

      <button className={styles.logoutBtn} onClick={onLogout} title="Logout">Logout</button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.svg"
        style={{ display: "none" }}
        onChange={handleFileChange}
        data-testid="image-file-input"
      />
      <input
        ref={importFileInputRef}
        type="file"
        accept=".merodesign,application/json"
        style={{ display: "none" }}
        onChange={handleImportFileChange}
        data-testid="import-file-input"
      />
    </div>
  );
}
