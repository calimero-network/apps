import { beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "../theme";
import { getActiveNamespaceId, getContextId, setActiveAudience } from "../lib/session";
import { signOut } from "./signOut";

const storedAudiences = () => Object.keys(localStorage).filter((k) => k.startsWith("mu-space:"));

beforeEach(() => {
  localStorage.clear();
});

describe("signOut", () => {
  it("drops the session and the open audience, and keeps the theme", () => {
    setActiveAudience("ctx-1", "exec-1", "ns-1", "http://localhost:2528");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(storedAudiences()).toHaveLength(1);
    const logout = vi.fn();

    signOut(logout);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(getContextId()).toBeNull();
    expect(getActiveNamespaceId()).toBeNull();
    expect(storedAudiences()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("mu-session") ?? "{}").contextId).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  it("forgets the audience before the session goes, so nothing re-enters it", () => {
    setActiveAudience("ctx-1", "exec-1", "ns-1", "http://localhost:2528");
    let audienceAtLogout: string | null = "unset";
    signOut(() => {
      audienceAtLogout = getContextId();
    });
    expect(audienceAtLogout).toBeNull();
  });
});
