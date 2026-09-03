/**
 * The reported bug was a message, not a crash path: every capture route showed
 *
 *     undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
 *
 * so these assert on the WORDING as much as the control flow. A guard that
 * throws something equally opaque would pass a shape-only test and fix nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireCamera,
  cameraUnavailableReason,
  describeGetUserMediaError,
} from "./media";

/** Install a `navigator.mediaDevices` (or remove it) for one test. */
function setMediaDevices(value: unknown) {
  Object.defineProperty(globalThis.navigator, "mediaDevices", {
    configurable: true,
    value,
  });
}

function setSecure(secure: boolean) {
  Object.defineProperty(globalThis.window, "isSecureContext", {
    configurable: true,
    value: secure,
  });
}

afterEach(() => {
  setMediaDevices(undefined);
  setSecure(true);
  vi.restoreAllMocks();
});

describe("cameraUnavailableReason", () => {
  it("blames the insecure origin when the page is not a secure context", () => {
    setMediaDevices(undefined);
    setSecure(false);
    const reason = cameraUnavailableReason();
    expect(reason).toMatch(/secure/i);
    expect(reason).toMatch(/https:\/\//);
    // Must not send the user chasing permissions — there is nothing to grant.
    expect(reason).not.toMatch(/allow camera/i);
  });

  it("blames the webview when the context IS secure but the API is missing", () => {
    setMediaDevices(undefined);
    setSecure(true);
    const reason = cameraUnavailableReason();
    expect(reason).toMatch(/navigator\.mediaDevices/);
    expect(reason).toMatch(/browser/i);
    expect(reason).not.toMatch(/secure page/i);
  });

  it("returns null once getUserMedia is actually there", () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    expect(cameraUnavailableReason()).toBeNull();
  });

  it("treats a mediaDevices object with no getUserMedia as unusable", () => {
    setMediaDevices({});
    expect(cameraUnavailableReason()).not.toBeNull();
  });
});

describe("acquireCamera", () => {
  it("never dereferences the missing object — the old TypeError cannot recur", async () => {
    setMediaDevices(undefined);
    await expect(acquireCamera({ video: true })).rejects.toThrow(
      /camera|secure/i,
    );
    // The exact string the bug report carried.
    await expect(acquireCamera({ video: true })).rejects.not.toThrow(
      /undefined is not an object/,
    );
  });

  it("passes the constraints straight through when the API exists", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices({ getUserMedia });
    await expect(acquireCamera({ video: { width: 640 } })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: 640 } });
  });

  it("translates a rejection instead of forwarding a bare DOMException", async () => {
    const err = Object.assign(new Error(""), { name: "NotAllowedError" });
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(err) });
    await expect(acquireCamera({ video: true })).rejects.toThrow(/refused/i);
  });
});

describe("describeGetUserMediaError", () => {
  it.each([
    ["NotAllowedError", /refused/i],
    ["SecurityError", /refused/i],
    ["NotFoundError", /no camera/i],
    ["OverconstrainedError", /no camera/i],
    ["NotReadableError", /another application/i],
    ["AbortError", /another application/i],
  ])("%s reads as %s", (name, pattern) => {
    expect(describeGetUserMediaError({ name })).toMatch(pattern);
  });

  it("keeps an unrecognised error's own message rather than inventing one", () => {
    expect(describeGetUserMediaError(new Error("something specific"))).toBe(
      "something specific",
    );
  });

  it("still says something when handed an empty rejection", () => {
    expect(describeGetUserMediaError(undefined)).toMatch(/could not be opened/i);
  });

  it("appends the underlying detail when there is one", () => {
    const err = Object.assign(new Error("device in use"), {
      name: "NotReadableError",
    });
    expect(describeGetUserMediaError(err)).toContain("device in use");
  });
});
