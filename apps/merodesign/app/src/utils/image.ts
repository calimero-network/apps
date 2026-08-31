/**
 * `blob:`/object URL → `data:` URL.
 *
 * The image cache holds object URLs, which are scoped to this document: written
 * into an exported SVG they resolve to nothing anywhere else. Anything already a
 * data URL is handed straight back.
 */
export async function toDataUrl(url: string): Promise<string> {
  if (url.startsWith("data:")) return url;
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read the cached image"));
    reader.readAsDataURL(blob);
  });
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 200, height: 150 });
    img.src = dataUrl;
  });
}
