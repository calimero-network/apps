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

/** How long to wait for the desktop to say how a download went — the macOS permission prompt waits on the user. */
const DOWNLOAD_RESULT_TIMEOUT_MS = 120_000;

export const DOWNLOADS_DENIED_MESSAGE =
  "The file could not be saved to your Downloads folder. If macOS asked and you chose “Don't Allow”, it won't ask again — " +
  "turn it on in System Settings → Privacy & Security → Files & Folders → Calimero Desktop → Downloads Folder, then save again.";

/**
 * Desktop save: click the download, then wait for the shell's verdict.
 *
 * The write happens outside the page, so on its own the page cannot tell a
 * saved file from one macOS refused (Downloads-folder access declined — macOS
 * asks once, and every save after that fails silently). The desktop reports
 * each download as a `calimero-download` event; it says it will by setting
 * `__CALIMERO_DOWNLOAD_EVENTS__`. An older desktop sets nothing, and the save
 * is assumed to have worked, as before.
 */
async function desktopDownload(href: string, filename: string): Promise<boolean> {
  const reports = !!(window as unknown as { __CALIMERO_DOWNLOAD_EVENTS__?: boolean }).__CALIMERO_DOWNLOAD_EVENTS__;
  if (!reports) {
    clickDownload(href, filename);
    return true;
  }
  // Listening before the click: the verdict can arrive before click() returns.
  const outcome = new Promise<{ success?: boolean } | null>((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("calimero-download", onResult);
      resolve(null);
    }, DOWNLOAD_RESULT_TIMEOUT_MS);
    function onResult(e: Event) {
      window.clearTimeout(timer);
      window.removeEventListener("calimero-download", onResult);
      resolve((e as CustomEvent<{ success?: boolean }>).detail ?? null);
    }
    window.addEventListener("calimero-download", onResult);
  });
  clickDownload(href, filename);
  const result = await outcome;
  if (result && result.success === false) throw new Error(DOWNLOADS_DENIED_MESSAGE);
  return true;
}

/**
 * Saves bytes under a name the user picks. Resolves `false` when the user
 * cancels, so callers can stay quiet instead of reporting a failure. Throws only
 * when the write itself failed (on desktop: the shell reported the download
 * failed) — callers surface that.
 */
export async function saveBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType: string,
): Promise<boolean> {
  const ext = extensionOf(filename);

  // Desktop: the same path mero-pixart uses. `showSaveFilePicker` does not exist
  // in the Tauri webview, so do not even look for it.
  if (isTauri()) return desktopDownload(encodeDataUrl(bytes, mimeType), filename);

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
  if (isTauri()) return desktopDownload(dataUrl, filename);
  return saveBytes(dataUrlToBytes(dataUrl), filename, mime);
}

/**
 * What to tell the user once a save went through. The desktop webview writes
 * the file straight into ~/Downloads with no prompt and no download bar, so
 * "exported" alone reads as nothing happened — say where it went. (wry renames
 * on a clash, "name (1).png", so name the folder rather than promise a path.)
 */
export function savedMessage(what: string, filename: string): string {
  return isTauri()
    ? `${what} saved to your Downloads folder as “${filename}”`
    : `${what} exported as “${filename}”`;
}

/** Convenience for text payloads (SVG markup, .mero-design JSON). */
export async function saveText(text: string, filename: string, mimeType: string): Promise<boolean> {
  return saveBytes(new TextEncoder().encode(text), filename, mimeType);
}
