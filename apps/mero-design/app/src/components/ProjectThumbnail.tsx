import { useEffect, useRef, useState } from "react";
import { useBoardPreview } from "../hooks/useBoardPreview";

/**
 * A project card's picture: a small, faithful render of what is on the board.
 *
 * It used to be a gradient hashed from the context id — distinct per project,
 * but it said nothing about the work inside. Now it is the board itself, fitted
 * to the card (see `utils/boardPreview`). An empty board, or one this node cannot
 * read yet, is plain white.
 *
 * The SVG goes through `<img>` (a blob URL), never inlined: an image document
 * runs no script, so no label or text on the board can become markup here.
 */

/** Card thumbnail proportions (ProjectsPage.module.css `.cardThumb`: ~240×110). */
const FALLBACK_ASPECT = 240 / 110;

interface Props {
  contextId: string;
  className?: string;
}

export default function ProjectThumbnail({ contextId, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(FALLBACK_ASPECT);

  // Only cards on screen fetch their board.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.clientWidth > 0 && el.clientHeight > 0) setAspect(el.clientWidth / el.clientHeight);
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const svg = useBoardPreview(contextId, visible, aspect);

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);

  const state = svg === undefined ? "loading" : svg === "" ? "empty" : "ready";
  return (
    <div
      ref={ref}
      className={className}
      data-testid={`project-thumb-${contextId}`}
      data-state={state}
      aria-hidden="true"
    >
      {url && <img src={url} alt="" draggable={false} data-testid={`project-preview-${contextId}`} />}
    </div>
  );
}
