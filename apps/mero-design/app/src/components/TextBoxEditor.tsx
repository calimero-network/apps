import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Canvas } from "fabric";
import type { Element } from "../types";
import { fontOf, inkOf, layoutBox, LINE_HEIGHT, measurerFor, paddingOf } from "../utils/boxText";

/**
 * Typing into a box or sticky note.
 *
 * A real <textarea> laid exactly over the box, the way Excalidraw edits text
 * in containers: a DOM field brings the caret, selection, IME composition,
 * spell-check and the platform's copy/paste for free, all of which Fabric's
 * IText only imitates. The canvas hides the box's own text while this is open
 * so the words are not drawn twice.
 *
 * Commits on blur, on Escape (as Excalidraw does — Escape leaves the field and
 * keeps the words) and on ⌘/Ctrl+Enter. Plain Enter is a newline.
 */

interface Props {
  element: Element;
  canvas: Canvas;
  /** The <canvas> element, to place the field relative to it. */
  canvasEl: HTMLCanvasElement;
  onCommit: (content: string) => void;
}

interface Placement {
  left: number;
  top: number;
  zoom: number;
}

function place(canvas: Canvas, canvasEl: HTMLCanvasElement, el: Element): Placement {
  const vpt = canvas.viewportTransform ?? [1, 0, 0, 1, 0, 0];
  const zoom = vpt[0] || 1;
  // The field sits in the canvas's positioned wrapper, so offset by where the
  // canvas itself sits inside it.
  const host = canvasEl.parentElement?.parentElement;
  const hostRect = host?.getBoundingClientRect();
  const canvasRect = canvasEl.getBoundingClientRect();
  const dx = hostRect ? canvasRect.left - hostRect.left : 0;
  const dy = hostRect ? canvasRect.top - hostRect.top : 0;
  return { left: dx + el.x * zoom + vpt[4], top: dy + el.y * zoom + vpt[5], zoom };
}

export default function TextBoxEditor({ element, canvas, canvasEl, onCommit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(element.data.content ?? "");
  const [placement, setPlacement] = useState(() => place(canvas, canvasEl, element));
  const committed = useRef(false);

  // Follow the board while it is zoomed or panned mid-edit.
  useEffect(() => {
    const update = () => setPlacement(place(canvas, canvasEl, element));
    canvas.on("after:render", update);
    return () => { canvas.off("after:render", update); };
  }, [canvas, canvasEl, element]);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    onCommit(value);
  };

  const { left, top, zoom } = placement;
  const size = element.data.fontSize ?? 16;
  const pad = paddingOf(element);
  // Same layout as the canvas paints, so the caret starts where the words were.
  const layout = layoutBox(
    { ...element, data: { ...element.data, content: value || " " } },
    element.width,
    element.height,
    measurerFor(fontOf(element), size),
  );

  return (
    <textarea
      ref={ref}
      data-testid="box-text-editor"
      aria-label={element.box === "sticky" ? "Sticky note text" : "Box text"}
      value={value}
      spellCheck
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        // Keys typed here belong to the field — never to the canvas's Delete,
        // Escape or tool shortcuts listening on the window.
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        position: "absolute",
        left,
        top,
        width: element.width * zoom,
        height: element.height * zoom,
        transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
        transformOrigin: "top left",
        boxSizing: "border-box",
        padding: `${Math.max(0, layout.top) * zoom}px ${pad * zoom}px 0`,
        margin: 0,
        border: "none",
        outline: "2px solid var(--color-accent, #0d99ff)",
        outlineOffset: 2,
        borderRadius: 2,
        background: "transparent",
        color: inkOf(element),
        font: fontOf({ ...element, data: { ...element.data, fontSize: size * zoom } }),
        lineHeight: LINE_HEIGHT,
        textAlign: layout.align,
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        zIndex: 20,
      }}
    />
  );
}
