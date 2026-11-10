import { MAX_LOGO_CHARS } from "./home";

/** The side, in pixels, a logo is scaled down to fit. */
const SIDE = 96;

/**
 * Reads an image file as a small square-fitted logo `data:` URL that fits in
 * the organization's metadata (at most {@link MAX_LOGO_CHARS}): scaled to fit
 * 96 px, then PNG, else WebP or JPEG at falling quality. Throws when even the
 * smallest does not fit, or the file is not an image the browser decodes.
 */
export async function readLogo(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("That file is not an image this browser can read.");
  });
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw the logo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const tries: Array<[string, number | undefined]> = [
    ["image/png", undefined],
    ["image/webp", 0.9],
    ["image/webp", 0.7],
    ["image/jpeg", 0.8],
    ["image/jpeg", 0.6],
  ];
  for (const [type, quality] of tries) {
    const url = canvas.toDataURL(type, quality);
    if (url.startsWith(`data:${type}`) && url.length <= MAX_LOGO_CHARS) return url;
  }
  throw new Error("That image is too detailed to fit as a logo: try a simpler one.");
}
