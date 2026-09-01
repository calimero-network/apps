import { describe, expect, it } from "vitest";
import { ARROW_TURN, arrowLook, isTauriRuntime, pointerLockAvailable } from "../src/input/look";

/** A window stand-in with a real requestPointerLock on Element.prototype. */
const fakeWindow = (globals: Record<string, unknown> = {}, hasLockApi = true): Window =>
  ({
    ...globals,
    Element: { prototype: hasLockApi ? { requestPointerLock: () => {} } : {} },
  }) as unknown as Window;

describe("isTauriRuntime", () => {
  it("trusts window.isTauri — the v2 marker set before any page script", () => {
    expect(isTauriRuntime(fakeWindow({ isTauri: true }))).toBe(true);
  });

  it("accepts the live v2 IPC bridge", () => {
    expect(isTauriRuntime(fakeWindow({ __TAURI_INTERNALS__: { invoke: () => {} } }))).toBe(true);
  });

  it("still recognizes the v1 global, as a trailing fallback", () => {
    expect(isTauriRuntime(fakeWindow({ __TAURI_INVOKE__: () => {} }))).toBe(true);
  });

  it("is false in a plain browser — including a bare __TAURI_INTERNALS__ with no invoke", () => {
    expect(isTauriRuntime(fakeWindow())).toBe(false);
    expect(isTauriRuntime(fakeWindow({ __TAURI_INTERNALS__: {} }))).toBe(false);
    // withGlobalTauri is false on every app window, so this must NOT count
    expect(isTauriRuntime(fakeWindow({ __TAURI__: {} }))).toBe(false);
  });
});

describe("pointerLockAvailable", () => {
  it("is true in a browser that has the API", () => {
    expect(pointerLockAvailable(fakeWindow())).toBe(true);
  });

  it("is false in the desktop shell even though WKWebView exposes the API", () => {
    // wry 0.55 has no pointer-lock delegate, so the call is a dead end there —
    // the API existing says nothing about the lock ever being granted.
    expect(pointerLockAvailable(fakeWindow({ isTauri: true }))).toBe(false);
  });

  it("is false where the API does not exist at all", () => {
    expect(pointerLockAvailable(fakeWindow({}, false))).toBe(false);
  });
});

describe("arrowLook", () => {
  // A single frame is clamped to 100ms (see the stall test below), so express
  // expectations in whole frames rather than in seconds.
  const FRAME = 100;
  const perFrame = (ARROW_TURN * FRAME) / 1000;
  const frame = (keys: string[], sensitivity = 1) =>
    arrowLook(new Set(keys), FRAME, sensitivity);

  it("turns right for ArrowRight, matching the mouse yaw convention (right = yaw down)", () => {
    expect(frame(["ArrowRight"]).dYaw).toBeCloseTo(-perFrame, 6);
    expect(frame(["ArrowLeft"]).dYaw).toBeCloseTo(perFrame, 6);
  });

  it("looks down for ArrowDown", () => {
    expect(frame(["ArrowDown"]).dPitch).toBeCloseTo(-perFrame, 6);
    expect(frame(["ArrowUp"]).dPitch).toBeCloseTo(perFrame, 6);
  });

  it("cancels opposing keys and idles at zero", () => {
    const both = frame(["ArrowLeft", "ArrowRight"]);
    expect(both.dYaw).toBeCloseTo(0, 12);
    expect(both.dPitch).toBeCloseTo(0, 12);
    const idle = frame([]);
    expect(idle.dYaw).toBeCloseTo(0, 12);
    expect(idle.dPitch).toBeCloseTo(0, 12);
  });

  it("scales with sensitivity and frame time", () => {
    expect(arrowLook(new Set(["ArrowRight"]), FRAME / 2, 1).dYaw).toBeCloseTo(-perFrame / 2, 6);
    expect(frame(["ArrowRight"], 2).dYaw).toBeCloseTo(-perFrame * 2, 6);
  });

  it("clamps a long frame so a stall doesn't spin the camera", () => {
    // a 2s hitch (tab restored, GC pause) must not turn 2 full seconds' worth
    expect(arrowLook(new Set(["ArrowRight"]), 2000, 1).dYaw).toBeCloseTo(
      arrowLook(new Set(["ArrowRight"]), 100, 1).dYaw,
      6,
    );
  });

  it("ignores keys it does not own", () => {
    const moving = frame(["KeyW", "Space"]);
    expect(moving.dYaw).toBeCloseTo(0, 12);
    expect(moving.dPitch).toBeCloseTo(0, 12);
  });
});
