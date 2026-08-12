import { dataUrlToBytes } from "./export";

/**
 * One seam for "write these bytes to a file the user chose".
 *
 * Item 9: exports did nothing in the desktop app. `showSaveFilePicker` does not
 * exist in the Tauri webview, and the `<a download>` fallback is ignored there, so
 * both branches dead-ended. `projectFile.exportProject` did not even use the shared
 * helper — it built its own anchor and failed for the same reason twice over.
 *
 * Under Tauri this goes through the dialog and fs plugins over the IPC bridge. The
 * plugin JS packages are not dependencies of this app (it is loaded *inside* the
 * desktop shell, which owns them), so the calls are made directly against
 * `__TAURI_INTERNALS__.invoke` — the same bridge `main.tsx` already keys off.
 *
 * NOTE for tauri-app: the desktop shell must grant `dialog:allow-save` and
 * `fs:allow-write-file` in its capabilities, or these reject with no visible error.
 */

interface TauriBridge {
  invoke: (cmd: string, args?: unknown) => Promise<unknown>;
}

function bridge(): TauriBridge | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriBridge };
  const b = w.__TAURI_INTERNALS__;
  return b && typeof b.invoke === "function" ? b : null;
}

export function isTauri(): boolean {
  return bridge() !== null;
}

const FILTERS: Record<string, { name: string; extensions: string[] }> = {
  png: { name: "PNG image", extensions: ["png"] },
  svg: { name: "SVG image", extensions: ["svg"] },
  merodesign: { name: "Mero Design project", extensions: ["merodesign"] },
};

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Saves bytes under a name the user picks. Resolves `false` when the user cancels,
 * so callers can stay quiet instead of reporting a failure.
 */
export async function saveBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<boolean> {
  const tauri = bridge();
  const ext = extensionOf(filename);

  if (tauri) {
    const path = (await tauri.invoke("plugin:dialog|save", {
      options: {
        defaultPath: filename,
        filters: [FILTERS[ext] ?? { name: ext.toUpperCase() || "File", extensions: [ext || "bin"] }],
      },
    })) as string | null;
    if (!path) return false;
    await tauri.invoke("plugin:fs|write_file", {
      path,
      data: Array.from(bytes),
      options: { baseDir: undefined },
    });
    return true;
  }

  // Browser: the File System Access API when present, else a download.
  const blob = new Blob([bytes as BlobPart], { type: mimeType });
  if ("showSaveFilePicker" in window) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: ext.toUpperCase() + " file", accept: { [mimeType]: ["." + ext] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err) {
      if ((err as Error).name === "AbortError") return false;
      // fall through to the anchor
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

/** Convenience for the canvas exporters, which produce data: URLs. */
export async function saveDataUrl(dataUrl: string, filename: string): Promise<boolean> {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "application/octet-stream";
  return saveBytes(dataUrlToBytes(dataUrl), filename, mime);
}

/** Convenience for text payloads (SVG markup, .merodesign JSON). */
export async function saveText(text: string, filename: string, mimeType: string): Promise<boolean> {
  return saveBytes(new TextEncoder().encode(text), filename, mimeType);
}
