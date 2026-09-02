import { describe, it, expect, vi, afterEach } from "vitest";
import { encodeDataUrl, isTauri, saveBytes, saveDataUrl } from "./saveFile";

/**
 * Item 9 (second pass): exports were dead in the desktop app, and the first fix
 * — dialog + fs plugin over the IPC bridge — was dead too, because the desktop
 * shell has no `tauri-plugin-fs` and grants `dialog:allow-save` only to its main
 * window. These tests pin the mechanism that actually works there, the same one
 * mero-pixart uses: an `<a download>` on a `data:` URL.
 *
 * The old versions of these tests passed against a bridge stub that answered
 * every invoke, which is why a broken export shipped looking tested.
 */
const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

function stubBridge() {
  const calls: { cmd: string; args: unknown }[] = [];
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: unknown) => {
      calls.push({ cmd, args });
      return Promise.resolve(null);
    },
  };
  return calls;
}

/** Captures the anchor a save would click, without navigating jsdom. */
function captureAnchor() {
  const clicked: { href: string; download: string }[] = [];
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    const el = realCreate(tag) as HTMLElement;
    if (tag === "a") {
      el.click = () => clicked.push({
        href: (el as HTMLAnchorElement).getAttribute("href") ?? "",
        download: (el as HTMLAnchorElement).download,
      });
    }
    return el;
  }) as typeof document.createElement);
  return clicked;
}

describe("saveBytes", () => {
  it("reports the browser when there is no Tauri bridge", () => {
    expect(isTauri()).toBe(false);
  });

  it("downloads through a data: URL under Tauri", async () => {
    stubBridge();
    const clicked = captureAnchor();
    expect(isTauri()).toBe(true);

    const ok = await saveBytes(new Uint8Array([137, 80, 78, 71]), "board.png", "image/png");

    expect(ok).toBe(true);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("board.png");
    expect(clicked[0].href.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("never invokes a Tauri plugin command — the shell has none of them", async () => {
    const calls = stubBridge();
    captureAnchor();
    await saveBytes(new Uint8Array([1, 2, 3]), "board.png", "image/png");
    expect(calls).toEqual([]);
  });

  it("never uses a blob: URL under Tauri — revoking races the download", async () => {
    stubBridge();
    const clicked = captureAnchor();
    await saveBytes(new Uint8Array([1]), "board.mero-design", "application/json");
    expect(clicked[0].href.startsWith("blob:")).toBe(false);
  });

  it("passes an existing data: URL through untouched", async () => {
    stubBridge();
    const clicked = captureAnchor();
    const url = "data:image/png;base64,AAAA";
    await saveDataUrl(url, "sel.png");
    expect(clicked[0].href).toBe(url);
  });

  it("round-trips bytes through the data: URL encoder", () => {
    const bytes = new Uint8Array([0, 1, 250, 255, 65]);
    const url = encodeDataUrl(bytes, "application/octet-stream");
    const decoded = atob(url.split(",")[1]);
    expect([...decoded].map((c) => c.charCodeAt(0))).toEqual([...bytes]);
  });

  it("encodes payloads larger than one 32k chunk", () => {
    const bytes = new Uint8Array(70_000).fill(7);
    const decoded = atob(encodeDataUrl(bytes, "image/png").split(",")[1]);
    expect(decoded.length).toBe(70_000);
    expect(decoded.charCodeAt(69_999)).toBe(7);
  });

  it("keeps the file picker in the browser", async () => {
    const written: BlobPart[] = [];
    const picker = vi.fn().mockResolvedValue({
      createWritable: async () => ({
        write: async (b: BlobPart) => { written.push(b); },
        close: async () => {},
      }),
    });
    (window as unknown as Record<string, unknown>).showSaveFilePicker = picker;
    try {
      const ok = await saveBytes(new Uint8Array([1]), "board.png", "image/png");
      expect(ok).toBe(true);
      expect(picker).toHaveBeenCalledWith(
        expect.objectContaining({ suggestedName: "board.png" }),
      );
      expect(written).toHaveLength(1);
    } finally {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    }
  });

  it("stays quiet when the browser picker is cancelled", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn().mockRejectedValue(abort);
    const clicked = captureAnchor();
    try {
      const ok = await saveBytes(new Uint8Array([1]), "board.png", "image/png");
      expect(ok).toBe(false);
      // A cancelled picker must not fall through and save the file anyway.
      expect(clicked).toHaveLength(0);
    } finally {
      delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    }
  });
});
