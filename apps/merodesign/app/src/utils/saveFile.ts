import { dataUrlToBytes } from "./export";

/**
 * One seam for "write these bytes to a file".
 *
 * Item 9: exports did nothing in the desktop app. The first fix routed Tauri
 * through `plugin:dialog|save` + `plugin:fs|write_file`, which looked right and
 * passed a stubbed-bridge e2e — but the desktop shell (tauri-app) does not
 * depend on `tauri-plugin-fs` at all, so `plugin:fs|write_file` is not a command
 * that exists, and `dialog:allow-save` is granted only to the `main` window, not
 * to the `app-*` windows apps run in. Both invokes rejected, the rejection was
 * awaited by a handler that ignored it, and the export vanished.
 *
 * mero-pixart downloads fine in the same desktop shell, and it just clicks an
 * `<a download>` pointed at a `data:` URL — wry's WKWebView download handler
 * takes it from there (the file lands in the browser/OS download location). So
 * this does the same. No desktop-side change, no new capability, nothing to
 * grant to arbitrary remote origins.
 *
 * Two details that matter and are easy to get wrong:
 *  - `data:` URL, not `blob:` — a blob URL revoked in the same tick as `.click()`
 *    races the download and yields a 0-byte file. The browser path keeps blob
 *    URLs (they are cheaper for large PNGs) but revokes on a timer.
 *  - the anchor is appended to the document. A detached anchor's click is
 *    ignored by some engines.
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

function extensionOf(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Bytes → `data:<mime>;base64,…`, chunked so a big PNG cannot blow the stack.
 * (Not `export.ts`'s `bytesToDataUrl`, which despite the name hands back an
 * object URL.)
 */
export function encodeDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

/** Clicks a download anchor. Kept in one place so both paths behave identically. */
function clickDownload(href: string, filename: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Saves bytes under a name the user picks. Resolves `false` when the user
 * cancels, so callers can stay quiet instead of reporting a failure. Throws only
 * when the write itself failed — callers surface that.
 */
export async function saveBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<boolean> {
  const ext = extensionOf(filename);

  // Desktop: the same path mero-pixart uses. `showSaveFilePicker` does not exist
  // in the Tauri webview, so do not even look for it.
  if (isTauri()) {
    clickDownload(encodeDataUrl(bytes, mimeType), filename);
    return true;
  }

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
      // The user closing the picker is not a failure, and must not fall through
      // to an anchor — that would save the file they just declined to save.
      if ((err as Error).name === "AbortError") return false;
      // Anything else (no permission, unsupported type) falls back to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  clickDownload(url, filename);
  // Revoking in this tick races the download; 60s is far past any handoff.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Convenience for the canvas exporters, which produce data: URLs. */
export async function saveDataUrl(dataUrl: string, filename: string): Promise<boolean> {
  const mime = dataUrl.slice(5, dataUrl.indexOf(";")) || "application/octet-stream";
  // Under Tauri the data: URL is already exactly what the anchor wants — do not
  // round-trip it through bytes and back.
  if (isTauri()) {
    clickDownload(dataUrl, filename);
    return true;
  }
  return saveBytes(dataUrlToBytes(dataUrl), filename, mime);
}

/** Convenience for text payloads (SVG markup, .merodesign JSON). */
export async function saveText(text: string, filename: string, mimeType: string): Promise<boolean> {
  return saveBytes(new TextEncoder().encode(text), filename, mimeType);
}
