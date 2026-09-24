import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "../store/canvasStore";
import { useScreenImage } from "../hooks/useScreenImage";
import { fitScreen, listScreens, type FitMode, type Screen } from "../utils/screens";
import styles from "./PresentationView.module.css";

/** Space kept clear around a slide shown whole, so it does not touch the chrome. */
const STAGE_MARGIN = 32;

const FIT_LABELS: Record<FitMode, string> = { fit: "Fit", width: "Fill width", actual: "100%" };

/**
 * Presentation mode: the board's screens, one at a time, full-window.
 *
 * Reads the live store, so an edit a peer makes arrives on the slide being
 * shown — presenting does not freeze the board. Navigation follows Figma's
 * present view: → / Space / PageDown forward, ← / Shift+Space / PageUp back,
 * Home / End, Esc to leave. A screen taller than the window scrolls instead of
 * shrinking to a strip, and Space pages through it before moving on.
 *
 * Every key is swallowed while presenting (capture phase, before the canvas's
 * own window listener): the board is still mounted underneath, and an arrow
 * key reaching it would nudge the selection, Backspace would delete it.
 */
export default function PresentationView() {
  const { elements, elementLabels, background, imageCache, presentation, stopPresentation } = useCanvasStore(
    useShallow((s) => ({
      elements: s.elements,
      elementLabels: s.elementLabels,
      background: s.background,
      imageCache: s.imageCache,
      presentation: s.presentation,
      stopPresentation: s.stopPresentation,
    })),
  );
  const screens = useMemo(() => listScreens(elements, elementLabels), [elements, elementLabels]);

  // Tracked by id, not index: a peer adding or moving a screen reorders the
  // list, and the slide on show must stay the slide on show.
  const [currentId, setCurrentId] = useState<string | null>(
    () => presentation?.startId ?? screens[0]?.id ?? null,
  );
  const index = Math.max(0, screens.findIndex((s) => s.id === currentId));
  const current: Screen | undefined = screens[index];
  // A deleted screen falls back to its neighbour rather than to nothing.
  useEffect(() => {
    if (screens.length > 0 && !screens.some((s) => s.id === currentId)) {
      setCurrentId(screens[Math.min(index, screens.length - 1)].id);
    }
  }, [screens, currentId, index]);

  const [mode, setMode] = useState<FitMode>("fit");
  const [showStrip, setShowStrip] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A new slide starts at its top.
  useEffect(() => {
    stageRef.current?.scrollTo({ top: 0, left: 0 });
  }, [current?.id, mode]);

  const go = useCallback((delta: number) => {
    if (screens.length === 0) return;
    const next = Math.min(screens.length - 1, Math.max(0, index + delta));
    setCurrentId(screens[next].id);
  }, [index, screens]);

  const goTo = useCallback((i: number) => {
    const s = screens[i];
    if (s) setCurrentId(s.id);
  }, [screens]);

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    stopPresentation();
  }, [stopPresentation]);

  const toggleFullscreen = useCallback(() => {
    // The desktop webview may refuse; presenting works the same without it.
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      e.stopImmediatePropagation();
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "select" || tag === "input") {
        if (e.key === "Escape") { e.preventDefault(); close(); }
        return;
      }
      const stage = stageRef.current;
      const canScrollDown = !!stage && stage.scrollTop + stage.clientHeight < stage.scrollHeight - 2;
      const canScrollUp = !!stage && stage.scrollTop > 2;
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          go(-1);
          break;
        case " ":
          e.preventDefault();
          // A long screen is read before it is left.
          if (!e.shiftKey && canScrollDown) stage!.scrollBy({ top: stage!.clientHeight * 0.85, behavior: "smooth" });
          else if (e.shiftKey && canScrollUp) stage!.scrollBy({ top: -stage!.clientHeight * 0.85, behavior: "smooth" });
          else go(e.shiftKey ? -1 : 1);
          break;
        case "ArrowDown":
        case "ArrowUp":
          e.preventDefault();
          stage?.scrollBy({ top: e.key === "ArrowDown" ? 80 : -80 });
          break;
        case "Home":
          e.preventDefault();
          goTo(0);
          break;
        case "End":
          e.preventDefault();
          goTo(screens.length - 1);
          break;
        case "f":
        case "F":
          if (e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          toggleFullscreen();
          break;
        default:
          // Undo, paste, delete… none of them may reach the board underneath.
          if (e.metaKey || e.ctrlKey || e.key === "Backspace" || e.key === "Delete") e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, go, goTo, screens.length, toggleFullscreen]);

  const url = useScreenImage(current, elements, background, imageCache);
  const margin = mode === "fit" ? STAGE_MARGIN : 0;
  const fit = current
    ? fitScreen(current.width, current.height, view.w - margin * 2, view.h - margin * 2, mode)
    : { scale: 1, scrolls: false };
  const drawW = current ? Math.round(current.width * fit.scale) : 0;
  const drawH = current ? Math.round(current.height * fit.scale) : 0;

  return (
    <div className={styles.root} role="dialog" aria-label="Presentation" data-testid="presentation">
      <header className={styles.bar}>
        <button className={styles.barBtn} onClick={close} title="Exit presentation (Esc)" data-testid="presentation-close">
          ✕ <span>Exit</span>
        </button>
        <div className={styles.title}>
          {current ? (
            <>
              <span className={styles.name} data-testid="presentation-title">{current.name}</span>
              <span className={styles.counter} data-testid="presentation-counter">{index + 1} / {screens.length}</span>
            </>
          ) : (
            <span className={styles.name}>No screens</span>
          )}
        </div>
        <div className={styles.barRight}>
          <div className={styles.segmented} role="group" aria-label="Zoom">
            {(Object.keys(FIT_LABELS) as FitMode[]).map((m) => (
              <button
                key={m}
                className={`${styles.segment} ${mode === m ? styles.segmentActive : ""}`}
                aria-pressed={mode === m}
                data-testid={`presentation-fit-${m}`}
                onClick={() => setMode(m)}
              >{FIT_LABELS[m]}</button>
            ))}
          </div>
          <button
            className={`${styles.barBtn} ${showStrip ? styles.barBtnActive : ""}`}
            onClick={() => setShowStrip((v) => !v)}
            title="Show all screens"
            aria-pressed={showStrip}
            data-testid="presentation-strip-toggle"
          >▤ <span>All screens</span></button>
          <button className={styles.barBtn} onClick={toggleFullscreen} title="Full screen (F)">
            ⤢ <span>Full screen</span>
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={`${styles.stage} ${fit.scrolls ? styles.stageScrolls : ""}`}
        data-testid="presentation-stage"
        data-scrolls={fit.scrolls ? "true" : "false"}
      >
        {current ? (
          <div className={styles.slideWrap} style={{ padding: margin }}>
            {url ? (
              <img
                className={styles.slide}
                src={url}
                alt={current.name}
                width={drawW}
                height={drawH}
                draggable={false}
                data-testid="presentation-slide"
                data-screen-id={current.id}
              />
            ) : (
              <div className={styles.slide} style={{ width: drawW, height: drawH, background }} />
            )}
          </div>
        ) : (
          <div className={styles.empty} data-testid="presentation-empty">
            <p className={styles.emptyTitle}>This board has no screens yet</p>
            <p className={styles.emptyHint}>
              Select the layers that make up a slide, then choose <b>Create screen</b> in the Screens tab.
              Every screen is presented in reading order — left to right, then top to bottom.
            </p>
            <button className={styles.emptyBtn} onClick={close}>Back to the board</button>
          </div>
        )}
      </div>

      {showStrip && screens.length > 0 && (
        <div className={styles.strip} data-testid="presentation-strip">
          {screens.map((s, i) => (
            <StripThumb
              key={s.id}
              screen={s}
              index={i}
              active={i === index}
              onSelect={() => goTo(i)}
            />
          ))}
        </div>
      )}

      {screens.length > 0 && (
        <footer className={styles.nav}>
          <button
            className={styles.navBtn}
            onClick={() => go(-1)}
            disabled={index === 0}
            title="Previous (←)"
            data-testid="presentation-prev"
          >‹</button>
          <div className={styles.dots}>
            {screens.map((s, i) => (
              <button
                key={s.id}
                className={`${styles.dot} ${i === index ? styles.dotActive : ""}`}
                onClick={() => goTo(i)}
                title={s.name}
                aria-label={`Go to ${s.name}`}
              />
            ))}
          </div>
          <button
            className={styles.navBtn}
            onClick={() => go(1)}
            disabled={index === screens.length - 1}
            title="Next (→)"
            data-testid="presentation-next"
          >›</button>
        </footer>
      )}
    </div>
  );
}

function StripThumb({ screen, index, active, onSelect }: {
  screen: Screen;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  const { elements, background, imageCache } = useCanvasStore(
    useShallow((s) => ({ elements: s.elements, background: s.background, imageCache: s.imageCache })),
  );
  const url = useScreenImage(screen, elements, background, imageCache);
  return (
    <button
      className={`${styles.thumb} ${active ? styles.thumbActive : ""}`}
      onClick={onSelect}
      title={screen.name}
      data-testid={`presentation-thumb-${screen.id}`}
    >
      <span className={styles.thumbFrame}>
        {url && <img src={url} alt="" draggable={false} />}
      </span>
      <span className={styles.thumbName}>{index + 1}. {screen.name}</span>
    </button>
  );
}
