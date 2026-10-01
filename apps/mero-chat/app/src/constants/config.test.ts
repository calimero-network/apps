import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getApplicationId,
  getContextMemberIdentity,
  getStoredGroupAlias,
  setContextMemberIdentity,
  setStoredGroupAlias,
} from "./config";

describe("getApplicationId", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("prefers the app-id URL hash param and persists it", () => {
    window.history.replaceState({}, "", "/#app-id=hash-app-id");

    expect(getApplicationId()).toBe("hash-app-id");
    expect(localStorage.getItem("calimero-application-id")).toBe("hash-app-id");
  });

  it("falls back to the stored id once the SSO bootstrap strips the hash", () => {
    // Desktop launch: main.tsx persists the hash app-id, then the hash is
    // stripped. A live URL read must NOT fall through to build-time defaults
    // (that made channel creation target the wrong application on the node).
    localStorage.setItem("calimero-application-id", "desktop-app-id");

    expect(getApplicationId()).toBe("desktop-app-id");
  });

  it("falls back to build defaults when neither URL nor storage have an id", () => {
    expect(getApplicationId()).not.toBe("");
  });
});

describe("per-context member identity storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores and retrieves a context member identity", () => {
    setContextMemberIdentity("ctx-1", "pk-abc123");

    expect(getContextMemberIdentity("ctx-1")).toBe("pk-abc123");
  });

  it("returns empty string for unknown context", () => {
    expect(getContextMemberIdentity("ctx-unknown")).toBe("");
  });

  it("stores multiple contexts independently", () => {
    setContextMemberIdentity("ctx-1", "pk-1");
    setContextMemberIdentity("ctx-2", "pk-2");

    expect(getContextMemberIdentity("ctx-1")).toBe("pk-1");
    expect(getContextMemberIdentity("ctx-2")).toBe("pk-2");
  });

  it("ignores calls with empty contextId or identity", () => {
    setContextMemberIdentity("", "pk-1");
    setContextMemberIdentity("ctx-1", "");

    expect(getContextMemberIdentity("")).toBe("");
    expect(getContextMemberIdentity("ctx-1")).toBe("");
  });
});

describe("config group alias cache", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stores and reads trimmed group aliases", () => {
    setStoredGroupAlias("group-1", "  Team Space  ");

    expect(getStoredGroupAlias("group-1")).toBe("Team Space");
  });

  it("treats storage failures as a best-effort cache miss", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(() => setStoredGroupAlias("group-1", "Team Space")).not.toThrow();

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(getStoredGroupAlias("group-1")).toBe("");
  });
});
