import { useRef, useState } from "react";
import { useEditorStore } from "../store/editorStore";
import { invertSelection, resizeSelection } from "../utils/geometry";
import { FILTERS, UNITS, type FilterKind, type LayerKind, type Member, type PanelId, type Role } from "../types";
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
  onAddLayer: (kind: LayerKind) => void;
  onDuplicateLayer: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  onGroupSelected: () => void;
  onToggleMask: (id: string) => void;
  onRasterize: () => void;
  onMergeDown: () => void;
  onMergeVisible: () => void;
  onFlatten: () => void;
  onOpenInvite: () => void;
  onOpenSettings: () => void;
  saving: boolean;
}

type MenuId =
  | "file" | "edit" | "image" | "layer" | "select"
  | "filter" | "view" | "window" | "help" | null;

// Bridge menu Cut/Copy/Paste to the canvas clipboard handlers (which listen for
// Ctrl+C/X/V on window) without coupling TopBar to CanvasStage internals.
function fireClipboard(key: "c" | "x" | "v") {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: true }));
}

/** Leading checkmark for toggle menu items (empty when off). */
function check(on: boolean): string {
  return on ? "✓ " : "";
}

export default function TopBar({
  docName, members, role, onBack, onImportImage, onImportSvg, onExport,
  onApplyFilter, onSelectAll, onDeselect, onAddLayer, onDuplicateLayer,
  onDeleteLayer, onGroupSelected, onToggleMask, onRasterize, onMergeDown,
  onMergeVisible, onFlatten, onOpenInvite, onOpenSettings, saving,
}: Props) {
  const {
    zoom, setZoom, setPan, undo, redo, undoStack, redoStack, selection,
    layers, selectedLayerId, doc, showRulers, toggleRulers, setTool,
    view, setView, guides, clearGuides, panels, togglePanel, setSelection,
  } = useEditorStore();
  const imgRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<MenuId>(null);

  const zoomPct = Math.round(zoom * 100);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;
  const hasSel = !!selectedLayerId && layers.some((l) => l.id === selectedLayerId);
  const close = () => setMenu(null);

  const fitScreen = () => {
    if (!doc) return;
    const vw = Math.max(200, window.innerWidth - 56 - 280 - 48);
    const vh = Math.max(200, window.innerHeight - 110);
    const z = Math.max(0.05, Math.min(8, Math.min(vw / doc.width, vh / doc.height)));
    setZoom(z);
    setPan(Math.max(8, (vw - doc.width * z) / 2), Math.max(8, (vh - doc.height * z) / 2));
  };
  const actualPixels = () => { setZoom(1); setPan(40, 40); };

  return (
    <header className={styles.bar}>
      <div className={styles.left}>
        <button className={styles.iconBtn} onClick={onBack} title="Back to projects" aria-label="Back to projects">
          <Icon name="chevronLeft" size={18} />
        </button>
        <span className={styles.logo}>Mero<b>PixArt</b></span>

        <nav className={styles.menus}>
          <Menu id="file" label="File" open={menu === "file"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { imgRef.current?.click(); close(); }}>Place Image…</button>
            <button onClick={() => { svgRef.current?.click(); close(); }}>Place SVG…</button>
            <hr />
            <button onClick={() => { onExport("png"); close(); }}>Export as PNG<kbd>⌘E</kbd></button>
            <button onClick={() => { onExport("jpeg"); close(); }}>Export as JPG</button>
            <button onClick={() => { onExport("svg"); close(); }}>Export as SVG</button>
            <hr />
            <button onClick={() => { onBack(); close(); }}>Close Project</button>
          </Menu>

          <Menu id="edit" label="Edit" open={menu === "edit"} anyOpen={menu !== null} onToggle={setMenu}>
            <button disabled={!canUndo} onClick={() => { undo(); close(); }}>Undo<kbd>⌘Z</kbd></button>
            <button disabled={!canRedo} onClick={() => { redo(); close(); }}>Redo<kbd>⌘⇧Z</kbd></button>
            <hr />
            <button disabled={!selection} onClick={() => { fireClipboard("x"); close(); }}>Cut<kbd>⌘X</kbd></button>
            <button disabled={!selection} onClick={() => { fireClipboard("c"); close(); }}>Copy<kbd>⌘C</kbd></button>
            <button onClick={() => { fireClipboard("v"); close(); }}>Paste<kbd>⌘V</kbd></button>
            <hr />
            <button onClick={() => { setTool("transform"); close(); }}>Free Transform<kbd>⌘T</kbd></button>
          </Menu>

          <Menu id="image" label="Image" open={menu === "image"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { onOpenSettings(); close(); }}>Canvas Size…</button>
            <button onClick={() => { onOpenSettings(); close(); }}>Image Size…</button>
            <hr />
            <button onClick={() => { setTool("crop"); close(); }}>Crop<kbd>C</kbd></button>
          </Menu>

          <Menu id="layer" label="Layer" open={menu === "layer"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { onAddLayer("raster"); close(); }}>New Raster Layer</button>
            <button onClick={() => { onAddLayer("text"); close(); }}>New Text Layer</button>
            <button onClick={() => { onAddLayer("fill"); close(); }}>New Fill Layer</button>
            <button onClick={() => { onAddLayer("group"); close(); }}>New Group</button>
            <hr />
            <button disabled={!hasSel} onClick={() => { if (selectedLayerId) onDuplicateLayer(selectedLayerId); close(); }}>Duplicate Layer</button>
            <button disabled={!hasSel} onClick={() => { if (selectedLayerId) onDeleteLayer(selectedLayerId); close(); }}>Delete Layer</button>
            <hr />
            <button disabled={!hasSel} onClick={() => { onGroupSelected(); close(); }}>Group Layer</button>
            <button disabled={!hasSel} onClick={() => { if (selectedLayerId) onToggleMask(selectedLayerId); close(); }}>Add / Remove Mask</button>
            <hr />
            <button disabled={!hasSel} onClick={() => { onRasterize(); close(); }}>Rasterize Layer</button>
            <button disabled={!hasSel} onClick={() => { onMergeDown(); close(); }}>Merge Down</button>
            <button disabled={layers.length < 2} onClick={() => { onMergeVisible(); close(); }}>Merge Visible</button>
            <button disabled={layers.length === 0} onClick={() => { onFlatten(); close(); }}>Flatten Image</button>
          </Menu>

          <Menu id="select" label="Select" open={menu === "select"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { onSelectAll(); close(); }}>Select All<kbd>⌘A</kbd></button>
            <button disabled={!selection} onClick={() => { onDeselect(); close(); }}>Deselect<kbd>⌘D</kbd></button>
            <button disabled={!selection} onClick={() => { if (selection) setSelection(invertSelection(selection)); close(); }}>Inverse<kbd>⌘⇧I</kbd></button>
            <hr />
            <span className={styles.menuHeading}>Modify</span>
            <button disabled={!selection || !doc} onClick={() => { if (selection && doc) setSelection(resizeSelection(selection, 8, { width: doc.width, height: doc.height })); close(); }}>Expand (8px)</button>
            <button disabled={!selection || !doc} onClick={() => { if (selection && doc) setSelection(resizeSelection(selection, -8, { width: doc.width, height: doc.height })); close(); }}>Contract (8px)</button>
            <hr />
            <button onClick={() => { setTool("marquee"); close(); }}>Rectangular Marquee<kbd>M</kbd></button>
            <button onClick={() => { setTool("lasso"); close(); }}>Lasso<kbd>L</kbd></button>
          </Menu>

          <Menu id="filter" label="Filter" open={menu === "filter"} anyOpen={menu !== null} onToggle={setMenu}>
            <span className={styles.menuHeading}>Apply to active layer</span>
            {FILTERS.map((f) => (
              <button key={f.kind} onClick={() => { onApplyFilter(f.kind); close(); }}>{f.label}</button>
            ))}
          </Menu>

          <Menu id="view" label="View" open={menu === "view"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { setZoom(zoom * 1.25); close(); }}>Zoom In<kbd>＋</kbd></button>
            <button onClick={() => { setZoom(zoom / 1.25); close(); }}>Zoom Out<kbd>−</kbd></button>
            <button onClick={() => { fitScreen(); close(); }}>Fit on Screen</button>
            <button onClick={() => { actualPixels(); close(); }}>Actual Pixels (100%)</button>
            <hr />
            <button onClick={() => { toggleRulers(); }}>{check(showRulers)}Rulers</button>
            <button onClick={() => { setView({ showGrid: !view.showGrid }); }}>{check(view.showGrid)}Grid</button>
            <button onClick={() => { setView({ showGuides: !view.showGuides }); }}>{check(view.showGuides)}Guides</button>
            <button onClick={() => { setView({ snap: !view.snap }); }}>{check(view.snap)}Snap</button>
            <button onClick={() => { setView({ showCrosshair: !view.showCrosshair }); }}>{check(view.showCrosshair)}Crosshair</button>
            <button disabled={guides.length === 0} onClick={() => { clearGuides(); close(); }}>Clear Guides</button>
            <hr />
            <span className={styles.menuHeading}>Units</span>
            {UNITS.map((u) => (
              <button key={u.unit} onClick={() => { setView({ units: u.unit }); }}>{check(view.units === u.unit)}{u.label}</button>
            ))}
            <hr />
            <span className={styles.menuHeading}>Transparency grid</span>
            {[8, 16, 32].map((sz) => (
              <button key={sz} onClick={() => { setView({ checkerSize: sz }); }}>
                {check(view.checkerSize === sz)}{sz === 8 ? "Small" : sz === 16 ? "Medium" : "Large"} ({sz}px)
              </button>
            ))}
          </Menu>

          <Menu id="window" label="Window" open={menu === "window"} anyOpen={menu !== null} onToggle={setMenu}>
            <span className={styles.menuHeading}>Panels</span>
            {([
              ["navigator", "Navigator"], ["adjustments", "Adjustments"],
              ["history", "History"], ["layers", "Layers"],
            ] as [PanelId, string][]).map(([id, label]) => (
              <button key={id} onClick={() => togglePanel(id)}>{check(panels[id])}{label}</button>
            ))}
            <hr />
            <button onClick={() => { toggleRulers(); }}>{check(showRulers)}Rulers</button>
          </Menu>

          <Menu id="help" label="Help" open={menu === "help"} anyOpen={menu !== null} onToggle={setMenu}>
            <button onClick={() => { window.open("https://github.com/calimero-network/mero-pixart", "_blank", "noopener"); close(); }}>GitHub Repository</button>
            <button onClick={() => { window.open("https://calimero.network", "_blank", "noopener"); close(); }}>About Calimero</button>
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
          <button className={styles.zoomVal} onClick={actualPixels} title="Reset zoom">{zoomPct}%</button>
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

function Menu({ id, label, open, anyOpen, onToggle, children }: {
  id: Exclude<MenuId, null>; label: string; open: boolean; anyOpen: boolean;
  onToggle: (m: MenuId) => void; children: React.ReactNode;
}) {
  return (
    <div className={styles.menuWrap}>
      <button
        className={`${styles.menuBtn} ${open ? styles.menuBtnOpen : ""}`}
        onClick={() => onToggle(open ? null : id)}
        // once a menu is open, hovering siblings switches to them (PS-style)
        onMouseEnter={() => { if (anyOpen) onToggle(id); }}
      >
        {label}
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => onToggle(null)} />
          <div className={styles.menu}>{children}</div>
        </>
      )}
    </div>
  );
}
