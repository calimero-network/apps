import { describe, it, expect } from "vitest";
import { detectTauri, hasDevSessionHash, type TauriGlobals } from "./tauri";

const web: TauriGlobals = {};

describe("detectTauri", () => {
  it("is false on the plain web", () => {
    expect(detectTauri(web)).toBe(false);
  });

  it("detects Tauri v2 by window.isTauri", () => {
    // Tauri v2 defines this in an unconditional main-frame init script, for
    // remote (https-hosted) app URLs too — see tauri's manager/webview.rs. It is
    // the only marker guaranteed present in every tauri-app window config.
    expect(detectTauri({ isTauri: true })).toBe(true);
  });

  it("detects Tauri v2 by the __TAURI_INTERNALS__ IPC bridge", () => {
    expect(detectTauri({ __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null) } })).toBe(
      true,
    );
  });

  it("detects the current desktop shell: withGlobalTauri OFF, v2 bridge on a remote URL", () => {
    // Exactly what tauri-app's calimero-shell hands an app page today: no
    // window.__TAURI__ (withGlobalTauri is false), no v1 globals at all.
    const shell: TauriGlobals = {
      isTauri: true,
      __TAURI_INTERNALS__: { invoke: () => Promise.resolve(null), metadata: {} },
    };
    expect(detectTauri(shell)).toBe(true);
  });

  it("still detects the legacy Tauri v1 shell", () => {
    expect(detectTauri({ __TAURI_INVOKE__: () => Promise.resolve(null) })).toBe(true);
    expect(detectTauri({ __TAURI_IPC__: () => {} })).toBe(true);
  });

  it("detects withGlobalTauri builds", () => {
    expect(detectTauri({ __TAURI__: { core: {} } })).toBe(true);
  });

  it("does not treat a non-true isTauri value as the desktop", () => {
    // A page-set `window.isTauri = "yes"` must not unlock the desktop-only UI.
    expect(detectTauri({ isTauri: "yes" })).toBe(false);
    expect(detectTauri({ isTauri: false })).toBe(false);
  });

  it("does not mistake a v1-shaped non-function for the IPC bridge", () => {
    expect(detectTauri({ __TAURI_INVOKE__: undefined })).toBe(false);
  });
});

describe("hasDevSessionHash", () => {
  it("accepts the dev harness hash in both casings", () => {
    expect(hasDevSessionHash("#node_url=http://localhost:2528&access_token=abc")).toBe(true);
    expect(hasDevSessionHash("nodeUrl=http://localhost:2528&access_token=abc")).toBe(true);
  });

  it("needs both a node and a token", () => {
    expect(hasDevSessionHash("#node_url=http://localhost:2528")).toBe(false);
    expect(hasDevSessionHash("#access_token=abc")).toBe(false);
    expect(hasDevSessionHash("")).toBe(false);
    expect(hasDevSessionHash("#")).toBe(false);
  });
});
