import { describe, it, expect, afterEach } from "vitest";
import { toggleFullscreen } from "./fullscreen";

const w = window as unknown as Record<string, unknown>;

function stubBridge(opts: { allowSet: boolean; full?: boolean }) {
  const calls: { cmd: string; args: unknown }[] = [];
  let full = opts.full ?? false;
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "app-mero-design" } },
    invoke: (cmd: string, args: { value?: boolean }) => {
      calls.push({ cmd, args });
      if (cmd === "plugin:window|is_fullscreen") return Promise.resolve(full);
      if (cmd === "plugin:window|set_fullscreen") {
        if (!opts.allowSet) return Promise.reject(new Error("not allowed"));
        full = !!args.value;
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    },
  };
  return calls;
}

afterEach(() => { delete w.__TAURI_INTERNALS__; });

describe("toggleFullscreen", () => {
  it("makes the desktop window full screen when the webview has no Fullscreen API", async () => {
    const calls = stubBridge({ allowSet: true });
    expect(await toggleFullscreen()).toBe("on");
    expect(calls).toContainEqual({ cmd: "plugin:window|set_fullscreen", args: { label: "app-mero-design", value: true } });
    expect(await toggleFullscreen()).toBe("off");
  });

  it("reports unsupported when the shell does not grant set_fullscreen", async () => {
    stubBridge({ allowSet: false });
    expect(await toggleFullscreen()).toBe("unsupported");
  });

  it("reports unsupported in a browser without the Fullscreen API", async () => {
    expect(await toggleFullscreen()).toBe("unsupported");
  });
});
