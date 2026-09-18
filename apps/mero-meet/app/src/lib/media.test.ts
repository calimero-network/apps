/**
 * The reported bug was a message, not a crash path: joining a call showed
 *
 *     undefined is not an object (evaluating 'navigator.mediaDevices.getUserMedia')
 *
 * so these assert on the WORDING as much as the control flow. A guard that
 * throws something equally opaque would pass a shape-only test and fix nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLocalMedia,
  localMediaUnavailableReason,
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

describe("localMediaUnavailableReason", () => {
  it("blames the insecure origin when the page is not a secure context", () => {
    setMediaDevices(undefined);
    setSecure(false);
    const reason = localMediaUnavailableReason();
    expect(reason).toMatch(/secure/i);
    expect(reason).toMatch(/https:\/\//);
    // Must not send the user chasing permissions — there is nothing to grant.
    expect(reason).not.toMatch(/allow camera/i);
  });

  it("blames the webview when the context IS secure but the API is missing", () => {
    setMediaDevices(undefined);
    setSecure(true);
    const reason = localMediaUnavailableReason();
    expect(reason).toMatch(/navigator\.mediaDevices/);
    expect(reason).toMatch(/browser/i);
    expect(reason).not.toMatch(/secure page/i);
  });

  it("returns null once getUserMedia is actually there", () => {
    setMediaDevices({ getUserMedia: vi.fn() });
    expect(localMediaUnavailableReason()).toBeNull();
  });

  it("treats a mediaDevices object with no getUserMedia as unusable", () => {
    setMediaDevices({});
    expect(localMediaUnavailableReason()).not.toBeNull();
  });
});

describe("acquireLocalMedia", () => {
  it("never dereferences the missing object — the old TypeError cannot recur", async () => {
    setMediaDevices(undefined);
    await expect(acquireLocalMedia({ video: true, audio: true })).rejects.toThrow(
      /camera|microphone|secure/i,
    );
    // The exact string the bug report carried.
    await expect(acquireLocalMedia({ video: true, audio: true })).rejects.not.toThrow(
      /undefined is not an object/,
    );
  });

  it("passes the constraints straight through when the API exists", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    setMediaDevices({ getUserMedia });
    await expect(acquireLocalMedia({ video: { width: 640 }, audio: true })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ video: { width: 640 }, audio: true });
  });

  it("translates a rejection instead of forwarding a bare DOMException", async () => {
    const err = Object.assign(new Error(""), { name: "NotAllowedError" });
    setMediaDevices({ getUserMedia: vi.fn().mockRejectedValue(err) });
    await expect(acquireLocalMedia({ video: true, audio: true })).rejects.toThrow(/refused/i);
  });
});

describe("describeGetUserMediaError", () => {
  it.each([
    ["NotAllowedError", /refused/i],
    ["SecurityError", /refused/i],
    ["NotFoundError", /no camera or microphone/i],
    ["OverconstrainedError", /no camera or microphone/i],
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

describe("which cause it blames", () => {
  // The whole point of this function is telling two fixes apart: "change the
  // URL you opened" and "open it somewhere else". Blaming the wrong one sends
  // people to reinstall a browser over a problem in their address bar.
  const withEnv = (opts: {
    secure: boolean | undefined;
    origin: string;
    hostname: string;
  }) => {
    const w = globalThis as unknown as Record<string, unknown>;
    const prevNav = w.navigator;
    const prevLoc = w.location;
    // navigator present but WITHOUT mediaDevices — the state being diagnosed.
    Object.defineProperty(w, "navigator", { value: {}, configurable: true });
    Object.defineProperty(w, "location", {
      value: { origin: opts.origin, hostname: opts.hostname },
      configurable: true,
    });
    Object.defineProperty(w, "isSecureContext", {
      value: opts.secure,
      configurable: true,
    });
    try {
      return localMediaUnavailableReason();
    } finally {
      Object.defineProperty(w, "navigator", { value: prevNav, configurable: true });
      Object.defineProperty(w, "location", { value: prevLoc, configurable: true });
    }
  };

  it("blames the ORIGIN when the page is plainly insecure", () => {
    const msg = withEnv({ secure: false, origin: "http://192.168.1.5:5177", hostname: "192.168.1.5" });
    expect(msg).toContain("secure page");
    expect(msg).toContain("http://192.168.1.5:5177");
  });

  it("blames the ORIGIN when the flag is missing but the host is not trustworthy", () => {
    // The regression this replaces: `isSecureContext !== false` treated
    // `undefined` as secure, so this case blamed the webview instead.
    const msg = withEnv({ secure: undefined, origin: "http://192.168.1.5:5177", hostname: "192.168.1.5" });
    expect(msg).toContain("secure page");
  });

  it("blames the WEBVIEW only when the origin really is trustworthy", () => {
    const msg = withEnv({ secure: true, origin: "https://mero-meet.vercel.app", hostname: "mero-meet.vercel.app" });
    expect(msg).toContain("never published it");
    expect(msg).toContain("https://mero-meet.vercel.app");
  });

  it("treats localhost over plain http as trustworthy", () => {
    const msg = withEnv({ secure: undefined, origin: "http://localhost:5177", hostname: "localhost" });
    expect(msg).toContain("never published it");
  });
});
