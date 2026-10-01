import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "../store/canvasStore";
import { useScreenActions } from "../hooks/useScreenActions";
import { useScreenImage } from "../hooks/useScreenImage";
import { elementsInScreen, listScreens, screenForSelection, type Screen } from "../utils/screens";
import { DRAG_THRESHOLD_PX, dropSlotAt, moveTarget, type DropSlot } from "../utils/screenReorder";
import LayerRowMenu from "./LayerRowMenu";
import styles from "./ScreensPanel.module.css";
import controls from "./ui/controls.module.css";

interface Props {
  contextId: string;
  readOnly?: boolean;
}

/**
 * The Screens tab: which parts of the board are slides, in the order they
 * present, and the way to make more. See `utils/screens.ts` for what a screen is.
 */
export default function ScreensPanel({ contextId, readOnly = false }: Props) {
  const { elements, elementLabels, selectedElementIds, selectElement, selectElements, startPresentation } =
    useCanvasStore(
      useShallow((s) => ({
        elements: s.elements,
        elementLabels: s.elementLabels,
        selectedElementIds: s.selectedElementIds,
        selectElement: s.selectElement,
        selectElements: s.selectElements,
        startPresentation: s.startPresentation,
      })),
    );
  const screens = useMemo(() => listScreens(elements, elementLabels), [elements, elementLabels]);
  const { createScreen, renameScreen, unmarkScreen, moveScreen } = useScreenActions(contextId, readOnly);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Drag to reorder: which row is being dragged, and where it would land.
  //
  // ⚠️ POINTER EVENTS, NOT HTML5 DRAG-AND-DROP. The desktop app opens this page
  // in a Tauri window whose native drag-drop handler is on (Tauri's default —
  // tauri-app never calls `disable_drag_drop_handler`), and that handler takes
  // the OS drag session: `dragover`/`drop` never reach the page, so the rows
  // could be picked up and never put down. WKWebView's own HTML5 drag is flaky
  // besides. A pointer drag is ordinary input every webview delivers.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropSlot | null>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** The press that may become a drag. Null once it is released or cancelled. */
  const press = useRef<{ index: number; pointerId: number; startY: number; dragging: boolean } | null>(null);
  /** A drag ends with a pointerup that the browser follows with a click. */
  const swallowClick = useRef(false);

  const selected = useMemo(() => {
    const ids = new Set(selectedElementIds);
    return elements.filter((e) => ids.has(e.id));
  }, [elements, selectedElementIds]);
  const startScreen = screenForSelection(screens, selected);

  function endDrag() {
    press.current = null;
    setDragIndex(null);
    setDrop(null);
  }

  function slotAt(clientY: number): DropSlot | null {
    const rows = Array.from(listRef.current?.children ?? []).map((row) => row.getBoundingClientRect());
    return dropSlotAt(rows, clientY);
  }

  function onRowPointerDown(index: number, e: React.PointerEvent<HTMLLIElement>) {
    if (e.button !== 0 || !e.isPrimary) return;
    // Presses on the row's own controls (menu, rename field) are not drags.
    if ((e.target as HTMLElement).closest("button, input, [data-no-drag]")) return;
    press.current = { index, pointerId: e.pointerId, startY: e.clientY, dragging: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onRowPointerMove(e: React.PointerEvent<HTMLLIElement>) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (!p.dragging) {
      if (Math.abs(e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
      p.dragging = true;
      setDragIndex(p.index);
    }
    const next = slotAt(e.clientY);
    setDrop((cur) => (cur && next && cur.index === next.index && cur.edge === next.edge ? cur : next));
  }

  function onRowPointerUp(e: React.PointerEvent<HTMLLIElement>) {
    const p = press.current;
    if (!p || p.pointerId !== e.pointerId) return;
    if (p.dragging) {
      swallowClick.current = true;
      const slot = slotAt(e.clientY);
      const to = slot ? moveTarget(p.index, slot) : null;
      if (to !== null) void moveScreen(p.index, to);
    }
    endDrag();
  }

  // Escape abandons a drag in flight. Capture phase, and stopped there, so the
  // board underneath does not also read it as "delete the selection".
  useEffect(() => {
    if (dragIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      swallowClick.current = true;
      endDrag();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragIndex]);

  function commitRename() {
    const id = editingId;
    setEditingId(null);
    if (id && draft.trim()) void renameScreen(id, draft);
  }

  return (
    <div className={styles.pane}>
      <div className={styles.toolbar}>
        <button
          className={styles.presentBtn}
          onClick={() => startPresentation(startScreen?.id ?? null)}
          disabled={screens.length === 0}
          title={startScreen ? `Present from “${startScreen.name}”` : "Present from the first screen"}
          data-testid="screens-present"
        >▶ Present{startScreen && screens.length > 1 ? ` from “${startScreen.name}”` : ""}</button>
        <button
          className={controls.iconButton}
          disabled={readOnly || selected.length === 0}
          onClick={() => void createScreen()}
          title="Make the selected layers a screen"
          data-testid="screens-create"
        >+ Create screen from selection</button>
      </div>

      {screens.length === 0 ? (
        <div className={styles.empty} data-testid="screens-empty">
          <p className={styles.emptyTitle}>No screens yet</p>
          <p className={styles.hint}>
            A screen is one slide of a presentation. Select the layers that belong together —
            or a single rectangle to use as the frame — and choose <b>Create screen</b>.
          </p>
          <p className={styles.hint}>
            Everything inside a screen’s area is part of it. Screens play left to right,
            then top to bottom — drag them in this list to change the order. A tall
            screen scrolls.
          </p>
        </div>
      ) : (
        <ol className={styles.list} ref={listRef}>
          {screens.map((s, i) => (
            <ScreenRow
              key={s.id}
              screen={s}
              index={i}
              count={screens.length}
              dragging={dragIndex === i}
              dropEdge={drop && dragIndex !== null && drop.index === i ? drop.edge : null}
              onPointerDown={(e) => onRowPointerDown(i, e)}
              onPointerMove={onRowPointerMove}
              onPointerUp={onRowPointerUp}
              onPointerCancel={endDrag}
              onMove={(delta) => void moveScreen(i, i + delta)}
              active={selectedElementIds.includes(s.id)}
              editing={editingId === s.id}
              draft={draft}
              readOnly={readOnly}
              onDraft={setDraft}
              onCommit={commitRename}
              onCancel={() => setEditingId(null)}
              onSelect={() => {
                if (swallowClick.current) { swallowClick.current = false; return; }
                selectElement(s.id);
              }}
              onPresent={() => startPresentation(s.id)}
              onRename={() => { setEditingId(s.id); setDraft(s.name); }}
              onSelectContents={() => selectElements(elementsInScreen(elements, s).map((e) => e.id))}
              onUnmark={() => void unmarkScreen(s.id)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

interface RowProps {
  screen: Screen;
  index: number;
  count: number;
  dragging: boolean;
  dropEdge: "before" | "after" | null;
  onPointerDown: (e: React.PointerEvent<HTMLLIElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLLIElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLLIElement>) => void;
  onPointerCancel: () => void;
  onMove: (delta: number) => void;
  active: boolean;
  editing: boolean;
  draft: string;
  readOnly: boolean;
  onDraft: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onSelect: () => void;
  onPresent: () => void;
  onRename: () => void;
  onSelectContents: () => void;
  onUnmark: () => void;
}

function ScreenRow(p: RowProps) {
  const { elements, background, imageCache } = useCanvasStore(
    useShallow((s) => ({ elements: s.elements, background: s.background, imageCache: s.imageCache })),
  );
  const url = useScreenImage(p.screen, elements, background, imageCache);
  const { screen } = p;
  const canMove = !p.readOnly && !p.editing;
  return (
    <li
      className={[
        styles.row,
        p.active ? styles.rowActive : "",
        canMove ? styles.rowReorderable : "",
        p.dragging ? styles.rowDragging : "",
        p.dropEdge === "before" ? styles.dropBefore : "",
        p.dropEdge === "after" ? styles.dropAfter : "",
      ].filter(Boolean).join(" ")}
      data-testid={`screen-row-${screen.id}`}
      data-drop={p.dropEdge ?? undefined}
      data-active={p.active ? "true" : undefined}
      tabIndex={0}
      // Never an HTML5 drag — see the note on the drag state in ScreensPanel.
      draggable={false}
      data-reorderable={canMove ? "true" : "false"}
      onClick={p.onSelect}
      onDoubleClick={p.onPresent}
      onKeyDown={(e) => {
        if (!canMove || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
        e.preventDefault();
        p.onMove(e.key === "ArrowUp" ? -1 : 1);
      }}
      onPointerDown={canMove ? p.onPointerDown : undefined}
      onPointerMove={canMove ? p.onPointerMove : undefined}
      onPointerUp={canMove ? p.onPointerUp : undefined}
      onPointerCancel={canMove ? p.onPointerCancel : undefined}
      title={canMove
        ? "Drag to reorder (or Alt+↑/↓) · click to select · double-click to present from here"
        : "Click to select · double-click to present from here"}
    >
      {canMove && <span className={styles.handle} aria-hidden="true">⠿</span>}
      <span className={styles.thumb}>
        {url && <img src={url} alt="" draggable={false} />}
        <span className={styles.number}>{p.index + 1}</span>
      </span>
      <span className={styles.meta}>
        {p.editing ? (
          <input
            autoFocus
            className={styles.nameInput}
            value={p.draft}
            onChange={(e) => p.onDraft(e.target.value)}
            onBlur={p.onCommit}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Enter") p.onCommit();
              if (e.key === "Escape") { e.stopPropagation(); p.onCancel(); }
            }}
            data-testid={`screen-name-input-${screen.id}`}
          />
        ) : (
          <span className={styles.name} data-testid={`screen-name-${screen.id}`}>{screen.name}</span>
        )}
        <span className={styles.size}>{screen.width} × {screen.height}</span>
      </span>
      <span data-no-drag onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <LayerRowMenu
          testId={`screen-menu-${screen.id}`}
          actions={[
            { label: "Present from here", onSelect: p.onPresent, testId: `screen-present-${screen.id}` },
            { label: "Move up", onSelect: () => p.onMove(-1), disabled: p.readOnly || p.index === 0, testId: `screen-move-up-${screen.id}` },
            { label: "Move down", onSelect: () => p.onMove(1), disabled: p.readOnly || p.index === p.count - 1, testId: `screen-move-down-${screen.id}` },
            { label: "Rename", onSelect: p.onRename, disabled: p.readOnly, testId: `screen-rename-${screen.id}` },
            { label: "Select contents", onSelect: p.onSelectContents },
            { label: "Remove screen", onSelect: p.onUnmark, disabled: p.readOnly, danger: true, testId: `screen-unmark-${screen.id}` },
          ]}
        />
      </span>
    </li>
  );
}
