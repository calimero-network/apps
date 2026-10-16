import { useEffect, useRef, useState } from "react";
import { rpcCall } from "../api/rpc";
import type { Element } from "../types";
import {
  buildBoardPreviewSvg,
  createLimiter,
  readCachedPreview,
  writeCachedPreview,
} from "../utils/boardPreview";

/** Shared by every card on the page: three boards load at a time, no more. */
const schedule = createLimiter(3);

/**
 * One read of a board serves every picture of it for a moment: the rail and the
 * team home's grid both show each board, and must not each fetch it.
 */
const SHARE_MS = 10_000;
const recent = new Map<string, { at: number; read: Promise<Element[]> }>();

function readBoard(contextId: string): Promise<Element[]> {
  const hit = recent.get(contextId);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.read;
  const read = schedule(() => rpcCall<Element[]>(contextId, "get_elements", {}))
    .then((els) => (Array.isArray(els) ? els : []));
  // A failure is not shared: the next picture asks again.
  read.catch(() => recent.delete(contextId));
  recent.set(contextId, { at: Date.now(), read });
  return read;
}

/**
 * The preview for one project: markup to draw, `""` for a white (empty or
 * unreadable) board, or `undefined` while nothing is known yet.
 *
 * Paints from the cache first, then — once the card has actually scrolled into
 * view — fetches the board and replaces it. A board that cannot be read (not
 * joined yet, node down) is white, never an error on the card.
 */
export function useBoardPreview(contextId: string, visible: boolean, aspect: number): string | undefined {
  const [preview, setPreview] = useState<string | undefined>(() => readCachedPreview(contextId));

  useEffect(() => {
    setPreview(readCachedPreview(contextId));
  }, [contextId]);

  // Once per card mount: coming back to the page after editing a board shows the
  // cached picture instantly, then the fresh one.
  const fetchedFor = useRef<string | null>(null);
  // A mounted flag, not a per-run `cancelled`: StrictMode runs the fetch effect,
  // cleans it up and runs it again, and the second run is (rightly) skipped by
  // `fetchedFor` — a per-run flag would have thrown the only result away.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!visible || !contextId || fetchedFor.current === contextId) return;
    fetchedFor.current = contextId;
    readBoard(contextId)
      .then((els) => buildBoardPreviewSvg(els, aspect) ?? "")
      .catch(() => {
        // Keep whatever was cached — a board that rendered last time is more
        // useful than white because the node blinked. Nothing cached → white.
        return readCachedPreview(contextId) ?? "";
      })
      .then((next) => {
        writeCachedPreview(contextId, next);
        if (mounted.current && fetchedFor.current === contextId) setPreview(next);
      });
  }, [contextId, visible, aspect]);

  return preview;
}
