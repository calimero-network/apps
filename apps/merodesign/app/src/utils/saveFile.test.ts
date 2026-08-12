import { describe, it, expect, vi, afterEach } from "vitest";
import { isTauri, saveBytes } from "./saveFile";

/**
 * Item 9: exports were dead in the desktop app. These cover the branch choice and
 * the argument shapes; the e2e specs cover the wiring through the real UI.
 */
const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  delete w.__TAURI_INTERNALS__;
  vi.restoreAllMocks();
});

function stubBridge(saveResult: string | null) {
  const calls: { cmd: string; args: unknown }[] = [];
  w.__TAURI_INTERNALS__ = {
    invoke: (cmd: string, args: unknown) => {
      calls.push({ cmd, args });
      if (cmd.startsWith("plugin:dialog|save")) return Promise.resolve(saveResult);
      return Promise.resolve(null);
    },
  };
  return calls;
}

describe("saveBytes", () => {
  it("reports the browser when there is no Tauri bridge", () => {
    expect(isTauri()).toBe(false);
  });

  it("goes through the dialog then the fs plugin under Tauri", async () => {
    const calls = stubBridge("/tmp/out.png");
    expect(isTauri()).toBe(true);
    const ok = await saveBytes(new Uint8Array([1, 2, 3]), "board.png", "image/png");
    expect(ok).toBe(true);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save", "plugin:fs|write_file"]);
  });

  it("passes the chosen path and the bytes to write_file", async () => {
    const calls = stubBridge("/tmp/out.png");
    await saveBytes(new Uint8Array([9, 8]), "board.png", "image/png");
    const write = calls[1].args as { path: string; data: number[] };
    expect(write.path).toBe("/tmp/out.png");
    expect(write.data).toEqual([9, 8]);
  });

  it("offers a matching file filter so the dialog suggests the extension", async () => {
    const calls = stubBridge("/tmp/x.merodesign");
    await saveBytes(new Uint8Array([1]), "board.merodesign", "application/json");
    const opts = (calls[0].args as { options: { filters: { extensions: string[] }[]; defaultPath: string } }).options;
    expect(opts.defaultPath).toBe("board.merodesign");
    expect(opts.filters[0].extensions).toContain("merodesign");
  });

  it("writes nothing when the user cancels the dialog", async () => {
    const calls = stubBridge(null);
    const ok = await saveBytes(new Uint8Array([1]), "board.png", "image/png");
    expect(ok).toBe(false);
    expect(calls.map((c) => c.cmd)).toEqual(["plugin:dialog|save"]);
  });

  it("never creates a download anchor under Tauri", async () => {
    stubBridge("/tmp/out.png");
    const spy = vi.spyOn(document, "createElement");
    await saveBytes(new Uint8Array([1]), "board.png", "image/png");
    expect(spy.mock.calls.filter(([tag]) => tag === "a")).toHaveLength(0);
  });
});
