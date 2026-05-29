export async function downloadDataUrl(dataUrl: string, filename: string): Promise<void> {
  if ("showSaveFilePicker" in window) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
    const mimeTypes: Record<string, string> = { png: "image/png", svg: "image/svg+xml" };
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fh = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: ext.toUpperCase() + " file", accept: { [mimeTypes[ext] ?? "application/octet-stream"]: ["." + ext] } }],
      });
      const writable = await fh.createWritable();
      const blob = await fetch(dataUrl).then((r) => r.blob());
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
  }
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
  a.remove();
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToDataUrl(bytes: number[], mimeType: string): string {
  const u8 = new Uint8Array(bytes);
  const blob = new Blob([u8], { type: mimeType });
  return URL.createObjectURL(blob);
}

export function guessImageMime(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  };
  return map[ext] ?? "image/png";
}
