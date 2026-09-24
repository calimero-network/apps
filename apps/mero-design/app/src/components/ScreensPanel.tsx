import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "../store/canvasStore";
import { useScreenActions } from "../hooks/useScreenActions";
import { useScreenImage } from "../hooks/useScreenImage";
import { elementsInScreen, listScreens, screenForSelection, type Screen } from "../utils/screens";
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
  const { createScreen, renameScreen, unmarkScreen } = useScreenActions(contextId, readOnly);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const selected = useMemo(() => {
    const ids = new Set(selectedElementIds);
    return elements.filter((e) => ids.has(e.id));
  }, [elements, selectedElementIds]);
  const startScreen = screenForSelection(screens, selected);

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
            then top to bottom; a tall screen scrolls.
          </p>
        </div>
      ) : (
        <ol className={styles.list}>
          {screens.map((s, i) => (
            <ScreenRow
              key={s.id}
              screen={s}
              index={i}
              active={selectedElementIds.includes(s.id)}
              editing={editingId === s.id}
              draft={draft}
              readOnly={readOnly}
              onDraft={setDraft}
              onCommit={commitRename}
              onCancel={() => setEditingId(null)}
              onSelect={() => selectElement(s.id)}
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
  return (
    <li
      className={`${styles.row} ${p.active ? styles.rowActive : ""}`}
      data-testid={`screen-row-${screen.id}`}
      onClick={p.onSelect}
      onDoubleClick={p.onPresent}
      title="Click to select · double-click to present from here"
    >
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
      <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <LayerRowMenu
          testId={`screen-menu-${screen.id}`}
          actions={[
            { label: "Present from here", onSelect: p.onPresent, testId: `screen-present-${screen.id}` },
            { label: "Rename", onSelect: p.onRename, disabled: p.readOnly, testId: `screen-rename-${screen.id}` },
            { label: "Select contents", onSelect: p.onSelectContents },
            { label: "Remove screen", onSelect: p.onUnmark, disabled: p.readOnly, danger: true, testId: `screen-unmark-${screen.id}` },
          ]}
        />
      </span>
    </li>
  );
}
