import { useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { FILTERS, type FilterKind, type Member, type Role } from "../types";
import { Icon } from "./ToolIcons";
import styles from "./TopBar.module.css";

interface Props {
  docName: string;
  members: Member[];
  role: Role;
  onBack: () => void;
  onImportImage: (file: File) => void;
  onImportSvg: (file: File) => void;
  onExport: (format: "png" | "jpeg" | "svg") => void;
  onApplyFilter: (kind: FilterKind) => void;
  onSelectAll: () => void;
  onDeselect: () => void;
  onOpenInvite: () => void;
  onOpenSettings: () => void;
  saving: boolean;
}

type MenuId = "file" | "edit" | "image" | null;

export default function TopBar({
  docName, members, role, onBack, onImportImage, onImportSvg, onExport,
  onApplyFilter, onSelectAll, onDeselect, onOpenInvite, onOpenSettings, saving,
}: Props) {
  const { zoom, setZoom, undo, redo, undoStack, redoStack, setPan, selection } = useEditorStore();
  const imgRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuId>(null);

  const zoomPct = Math.round(zoom * 100);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const close = () => setMenu(null);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <button className={styles.iconBtn} onClick={onBack} title="Back to projects" aria-label="Back to projects">
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className={styles.logo}>Mero<b>PixArt</b></span>

        <nav className={styles.menus}>
          <Menu id="file" label="File" open={menu === "file"} onToggle={setMenu}>
            <button onClick={() => { imgRef.current?.click(); close(); }}>Place Image…</button>
            <button onClick={() => { svgRef.current?.click(); close(); }}>Place SVG…</button>
            <hr />
            <button onClick={() => { onExport("png"); close(); }}>Export as PNG</button>
            <button onClick={() => { onExport("jpeg"); close(); }}>Export as JPG</button>
            <button onClick={() => { onExport("svg"); close(); }}>Export as SVG</button>
          </Menu>

          <Menu id="edit" label="Edit" open={menu === "edit"} onToggle={setMenu}>
            <button disabled={!canUndo} onClick={() => { undo(); close(); }}>Undo<kbd>⌘Z</kbd></button>
            <button disabled={!canRedo} onClick={() => { redo(); close(); }}>Redo<kbd>⌘⇧Z</kbd></button>
            <hr />
            <button onClick={() => { onSelectAll(); close(); }}>Select All<kbd>⌘A</kbd></button>
            <button disabled={!selection} onClick={() => { onDeselect(); close(); }}>Deselect<kbd>⌘D</kbd></button>
          </Menu>

          <Menu id="image" label="Image" open={menu === "image"} onToggle={setMenu}>
            <span className={styles.menuHeading}>Filters (active layer)</span>
            {FILTERS.map((f) => (
              <button key={f.kind} onClick={() => { onApplyFilter(f.kind); close(); }}>{f.label}</button>
            ))}
          </Menu>
        </nav>

        <span className={styles.divider} />

        <button className={styles.iconBtn} title="Undo (⌘Z)" aria-label="Undo" disabled={!canUndo} onClick={undo}>
          <Icon name="undo" size={17} />
        </button>
        <button className={styles.iconBtn} title="Redo (⌘⇧Z)" aria-label="Redo" disabled={!canRedo} onClick={redo}>
          <Icon name="redo" size={17} />
        </button>
        <button className={styles.iconBtn} title="Place image" aria-label="Place image" onClick={() => imgRef.current?.click()}>
          <Icon name="image" size={17} />
        </button>
        <button className={styles.iconBtn} title="Export as PNG" aria-label="Export as PNG" onClick={() => onExport("png")}>
          <Icon name="download" size={17} />
        </button>
      </div>

      <div className={styles.center}>
        <span className={styles.docName}>{docName || "Untitled"}</span>
        {saving && <span className={styles.saving}>saving…</span>}
      </div>

      <div className={styles.right}>
        <div className={styles.zoom}>
          <button onClick={() => setZoom(zoom / 1.25)} title="Zoom out">−</button>
          <button className={styles.zoomVal} onClick={() => { setZoom(1); setPan(40, 40); }} title="Reset zoom">{zoomPct}%</button>
          <button onClick={() => setZoom(zoom * 1.25)} title="Zoom in">＋</button>
        </div>

        <div className={styles.members} title={members.map((m) => m.username).join(", ")}>
          {members.slice(0, 4).map((m, i) => (
            <span key={m.id} className={styles.avatar} style={{ zIndex: 10 - i }}>
              {(m.username || "?").charAt(0).toUpperCase()}
            </span>
          ))}
          {members.length > 4 && <span className={styles.avatarMore}>+{members.length - 4}</span>}
        </div>

        <span className={`${styles.role} ${styles["role_" + role]}`}>{role}</span>

        <button className="mp-btn mp-btn--ghost" onClick={onOpenInvite}>Invite</button>
        <button className="mp-btn" onClick={onOpenSettings}>Settings</button>
      </div>

      <input ref={imgRef} type="file" accept="image/*" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportImage(f); e.target.value = ""; }} />
      <input ref={svgRef} type="file" accept=".svg,image/svg+xml" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportSvg(f); e.target.value = ""; }} />
    </header>
  );
}

function Menu({ id, label, open, onToggle, children }: {
  id: Exclude<MenuId, null>; label: string; open: boolean;
  onToggle: (m: MenuId) => void; children: React.ReactNode;
}) {
  return (
    <div className={styles.menuWrap}>
      <button className={`${styles.menuBtn} ${open ? styles.menuBtnOpen : ""}`} onClick={() => onToggle(open ? null : id)}>{label}</button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => onToggle(null)} />
          <div className={styles.menu}>{children}</div>
        </>
      )}
    </div>
  );
}
