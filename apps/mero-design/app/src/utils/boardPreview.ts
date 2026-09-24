import type { Element } from "../types";
import { boundsOf, elementsToSvg, type Bounds } from "./svgExport";

/**
 * The small picture of a board on its project card.
 *
 * Built from the board's contract elements with the same SVG renderer as screen
 * thumbnails and exports, so the card shows what is actually on the board. It
 * stays cheap on purpose: no blob is ever fetched for it — image elements come
 * out as the renderer's light grey placeholder box, because `imageData` is never
 * passed — and the result is cached per project so a return visit paints at once.
 */

/** Board background on a card. An empty board is exactly this and nothing else. */
export const PREVIEW_BACKGROUND = "#ffffff";

/** Content box, grown to the card's aspect ratio and centred, with a margin. */
export function previewBounds(elements: Element[], aspect: number): Bounds {
  const content = boundsOf(elements);
  // A margin proportional to the content, so a lone small shape is not glued to
  // the card's edges and a huge board is not shrunk by a fixed amount.
  const margin = Math.max(content.width, content.height) * 0.06 + 8;
  let width = content.width + margin * 2;
  let height = content.height + margin * 2;
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 2;
  if (width / height < safe) width = height * safe;
  else height = width / safe;
  const cx = content.x + content.width / 2;
  const cy = content.y + content.height / 2;
  return {
    x: Math.round(cx - width / 2),
    y: Math.round(cy - height / 2),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/**
 * The board as SVG markup at the card's aspect ratio, or `null` for a board with
 * nothing on it — the card then shows plain white.
 */
export function buildBoardPreviewSvg(elements: Element[], aspect: number): string | null {
  if (!Array.isArray(elements) || elements.length === 0) return null;
  return elementsToSvg(elements, {
    bounds: previewBounds(elements, aspect),
    background: PREVIEW_BACKGROUND,
  });
}

/* ── cache ─────────────────────────────────────────────────────────────── */

/**
 * `""` means "known to be empty" (white card). A missing entry means "never
 * seen" — the two must stay distinguishable, or an empty board would be fetched
 * on every visit forever.
 */
export type CachedPreview = string;

const KEY_PREFIX = "md-board-preview:";
const INDEX_KEY = "md-board-preview-index";
/** Previews bigger than this are kept in memory only; localStorage is ~5MB total. */
export const MAX_ENTRY_CHARS = 80_000;
/** How many projects' previews survive in localStorage, most recently used first. */
export const MAX_ENTRIES = 40;

const memory = new Map<string, CachedPreview>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readIndex(s: Storage): string[] {
  try {
    const raw = JSON.parse(s.getItem(INDEX_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function readCachedPreview(contextId: string): CachedPreview | undefined {
  const hit = memory.get(contextId);
  if (hit !== undefined) return hit;
  const s = storage();
  if (!s) return undefined;
  try {
    const stored = s.getItem(KEY_PREFIX + contextId);
    if (stored === null) return undefined;
    memory.set(contextId, stored);
    return stored;
  } catch {
    return undefined;
  }
}

export function writeCachedPreview(contextId: string, preview: CachedPreview): void {
  memory.set(contextId, preview);
  const s = storage();
  if (!s) return;
  try {
    const index = readIndex(s).filter((id) => id !== contextId);
    if (preview.length > MAX_ENTRY_CHARS) {
      // Too big to persist; drop any older, smaller copy so it cannot resurface.
      s.removeItem(KEY_PREFIX + contextId);
      s.setItem(INDEX_KEY, JSON.stringify(index));
      return;
    }
    index.unshift(contextId);
    for (const evicted of index.splice(MAX_ENTRIES)) s.removeItem(KEY_PREFIX + evicted);
    s.setItem(KEY_PREFIX + contextId, preview);
    s.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Quota or a disabled store: the memory copy still serves this session.
  }
}

/** Test hook: forget the in-memory layer (localStorage is cleared by the test). */
export function clearPreviewMemory(): void {
  memory.clear();
}

/* ── concurrency ───────────────────────────────────────────────────────── */

/**
 * At most `limit` tasks in flight; the rest wait their turn in order. A team
 * with thirty projects must not fire thirty `get_elements` calls at the node at
 * once just because the page was opened.
 */
export function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (run) run();
  };
  return function schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}
