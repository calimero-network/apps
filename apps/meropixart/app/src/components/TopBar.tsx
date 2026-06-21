import { useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import type { Member, Role } from "../types";
import styles from "./TopBar.module.css";

interface Props {
  docName: string;
  members: Member[];
  role: Role;
  onBack: () => void;
  onImportImage: (file: File) => void;
  onExport: (format: "png" | "jpeg") => void;
  onOpenInvite: () => void;
  onOpenSettings: () => void;
  saving: boolean;
}

export default function TopBar({
  docName, members, role, onBack, onImportImage, onExport, onOpenInvite, onOpenSettings, saving,
}: Props) {
  const { zoom, setZoom, undo, redo, undoStack, redoStack, setPan } = useEditorStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<"file" | null>(null);

  const zoomPct = Math.round(zoom * 100);

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <button className={styles.back} onClick={onBack} title="Back to projects">‹</button>
        <span className={styles.logo}>Mero<b>PixArt</b></span>

        <div className={styles.menuWrap}>
          <button className={styles.menuBtn} onClick={() => setMenu(menu === "file" ? null : "file")}>File</button>
          {menu === "file" && (
            <>
              <div className={styles.backdrop} onClick={() => setMenu(null)} />
              <div className={styles.menu}>
                <button onClick={() => { fileRef.current?.click(); setMenu(null); }}>Place image…</button>
                <button onClick={() => { onExport("png"); setMenu(null); }}>Export PNG</button>
                <button onClick={() => { onExport("jpeg"); setMenu(null); }}>Export JPG</button>
              </div>
            </>
          )}
        </div>

        <button className={styles.tool} title="Undo (⌘Z)" disabled={undoStack.length === 0} onClick={undo}>↶</button>
        <button className={styles.tool} title="Redo (⌘⇧Z)" disabled={redoStack.length === 0} onClick={redo}>↷</button>
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

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportImage(f); e.target.value = ""; }}
      />
    </header>
  );
}
