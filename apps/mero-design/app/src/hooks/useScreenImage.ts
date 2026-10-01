import { useEffect, useMemo, useState } from "react";
import type { Element } from "../types";
import { toDataUrl } from "../utils/image";
import { elementsInScreen, screenToSvg, type Screen } from "../utils/screens";

/**
 * A screen, rendered to an `<img>`-ready URL.
 *
 * The SVG is shown through `<img>` rather than inlined: an image document runs
 * no script and loads nothing, so no label or text content can ever become
 * markup in the page. The price is that it cannot reach `blob:` URLs either, so
 * every bitmap is embedded as a `data:` URL first — the same reason the SVG
 * export does it (`imageDataFor`).
 */

/** Cache of object URL → data URL, shared by every screen and thumbnail. */
const dataUrls = new Map<string, Promise<string | null>>();

function dataUrlOf(src: string): Promise<string | null> {
  let pending = dataUrls.get(src);
  if (!pending) {
    pending = toDataUrl(src).catch(() => null);
    dataUrls.set(src, pending);
  }
  return pending;
}

/** id → data URL for the bitmaps this screen shows, filled in as they convert. */
function useImageData(members: Element[], imageCache: Record<string, string>) {
  const [imageData, setImageData] = useState<Record<string, string>>({});
  const wanted = members
    .filter((el) => (el.data.kind === "image" || el.data.kind === "svg") && imageCache[el.id])
    .map((el) => [el.id, imageCache[el.id]] as const);
  const key = wanted.map(([id, src]) => `${id}=${src}`).join("|");

  useEffect(() => {
    let cancelled = false;
    Promise.all(wanted.map(async ([id, src]) => [id, await dataUrlOf(src)] as const)).then((pairs) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, url] of pairs) if (url) next[id] = url;
      setImageData(next);
    });
    return () => { cancelled = true; };
    // `key` is `wanted`, flattened — the array itself is new every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return imageData;
}

export function useScreenImage(
  screen: Screen | undefined,
  elements: Element[],
  background: string,
  imageCache: Record<string, string>,
): string | null {
  const members = useMemo(
    () => (screen ? elementsInScreen(elements, screen) : []),
    [elements, screen],
  );
  const imageData = useImageData(members, imageCache);
  const svg = useMemo(
    () => (screen ? screenToSvg(members, screen, { background, imageData }) : null),
    [members, screen, background, imageData],
  );

  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!svg) {
      setUrl(null);
      return;
    }
    // An object URL, not a `data:` one: a screen full of embedded bitmaps is
    // megabytes, and percent-encoding that on every edit is the slow part.
    const next = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [svg]);
  return url;
}
