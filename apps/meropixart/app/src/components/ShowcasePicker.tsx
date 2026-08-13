import { useEffect, useRef, useState } from "react";
import { SHOWCASE_PROJECTS } from "../showcase";
import { renderShowcaseThumb } from "../showcase/preview";
import type { ShowcaseProject } from "../showcase/types";
import styles from "./ShowcasePicker.module.css";

interface Props {
  /** Whether the current document already has layers (so loading replaces work). */
  hasContent: boolean;
  onPick: (project: ShowcaseProject) => void;
  onClose: () => void;
  busy?: string;
}

/**
 * The showcase gallery.
 *
 * Each card's image is rendered on the spot by the same compositor that draws the
 * canvas, so what you pick is exactly what lands in the document. Loading over an
 * occupied document asks once, because it clears every existing layer.
 */
export default function ShowcasePicker({ hasContent, onPick, onClose, busy }: Props) {
  const [armed, setArmed] = useState<string | null>(null);

  return (
    <div className="mp-overlay" onClick={() => !busy && onClose()}>
      <div
        className={`mp-modal ${styles.modal}`}
        onClick={(e) => e.stopPropagation()}
        data-testid="showcase-picker"
      >
        <h2>Showcase projects</h2>
        <p className="sub">
          Complete documents built entirely in MeroPixArt — open one to see what the
          editor can do, then take it apart.
        </p>

        <div className={styles.grid}>
          {SHOWCASE_PROJECTS.map((p) => (
            <div key={p.id} className={styles.card} data-testid={`showcase-card-${p.id}`}>
              <Thumb project={p} />
              <div className={styles.body}>
                <h3 className={styles.name}>{p.name}</h3>
                <p className={styles.tagline}>{p.tagline}</p>
                <ul className={styles.notes}>
                  {p.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
                <div className={styles.meta}>
                  <span>{p.width} × {p.height}</span>
                  <span className={styles.dot}>·</span>
                  <span>{p.layers.length} layers</span>
                  <span className={styles.dot}>·</span>
                  <span>{p.layers.filter((l) => l.kind === "group").length} folders</span>
                </div>
                <button
                  type="button"
                  className="mp-btn mp-btn--primary"
                  disabled={!!busy}
                  data-testid={armed === p.id ? `showcase-confirm-${p.id}` : `showcase-open-${p.id}`}
                  onClick={() => {
                    if (hasContent && armed !== p.id) { setArmed(p.id); return; }
                    onPick(p);
                  }}
                >
                  {busy === p.id ? "Loading…"
                    : armed === p.id ? "Replace every layer — confirm"
                    : "Open"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {busy && <p className={styles.busy} data-testid="showcase-busy">Building layers on the node…</p>}

        <div className={styles.actions}>
          <button className="mp-btn mp-btn--ghost" onClick={onClose} disabled={!!busy}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** A card image, rendered once per project and cached for the session. */
const thumbCache = new Map<string, string>();

function Thumb({ project }: { project: ShowcaseProject }) {
  const [url, setUrl] = useState<string>(() => thumbCache.get(project.id) ?? "");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (thumbCache.has(project.id)) return () => { alive.current = false; };
    // Rendering four full-size posters at once would block the modal's first
    // paint, so each card renders on the next frame and fills in.
    const handle = requestAnimationFrame(() => {
      try {
        const data = renderShowcaseThumb(project, 520, 520).toDataURL("image/png");
        thumbCache.set(project.id, data);
        if (alive.current) setUrl(data);
      } catch {
        // A canvas-less environment (or an out-of-memory render) just leaves the
        // placeholder — the card is still usable.
      }
    });
    return () => { alive.current = false; cancelAnimationFrame(handle); };
  }, [project]);

  return (
    <div
      className={`${styles.thumb} mp-checkerboard`}
      style={{ aspectRatio: `${project.width} / ${project.height}` }}
      data-testid={`showcase-thumb-${project.id}`}
    >
      {url
        ? <img src={url} alt={`${project.name} preview`} />
        : <span className={styles.thumbBusy}>rendering…</span>}
    </div>
  );
}
