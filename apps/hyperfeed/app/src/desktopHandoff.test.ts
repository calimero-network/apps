import { afterEach, describe, expect, it, vi } from "vitest";
import { handToDesktop, refusedByNode } from "./desktopHandoff";

describe("handing a refused call to Calimero Desktop", () => {
  afterEach(() => {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("takes a 403 as the node refusing this session, but not a revoked login", () => {
    expect(refusedByNode(Object.assign(new Error("HTTP 403 Forbidden"), { status: 403 }))).toBe(true);
    const revoked = Object.assign(new Error("Authentication revoked"), { status: 403, name: "AuthRevokedError" });
    expect(refusedByNode(revoked)).toBe(false);
    expect(refusedByNode(Object.assign(new Error("HTTP 500"), { status: 500 }))).toBe(false);
    expect(refusedByNode(new Error("offline"))).toBe(false);
  });

  it("sends the desktop's app link as its event from inside a desktop window", async () => {
    const invoke = vi.fn(async () => undefined);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };

    await handToDesktop("com.calimero.hyperfeed", "delete-context", "context=ctx-1");

    expect(invoke).toHaveBeenCalledWith("plugin:event|emit", {
      event: "app-deep-link",
      payload: { slug: "com.calimero.hyperfeed", action: "delete-context", params: "context=ctx-1" },
    });
  });
});
