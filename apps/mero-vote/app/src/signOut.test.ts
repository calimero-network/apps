import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOut } from "./signOut";
import { THEME_STORAGE_KEY } from "./theme";
import { loadTrusteeKey, saveTrusteeKey } from "./utils/trusteeKeys";

beforeEach(() => localStorage.clear());

describe("signOut", () => {
  it("forgets the open context, ends the session, and keeps the theme and trustee keys", () => {
    localStorage.setItem("mero:context_id", "ctx-1");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const key = { v: 1 as const, contextId: "ctx-1", pollId: "poll-1", account: "acc-1", secret: "ab".repeat(32) };
    saveTrusteeKey(key);
    const logout = vi.fn();

    signOut(logout);

    expect(logout).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("mero:context_id")).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadTrusteeKey("ctx-1", "poll-1", "acc-1")).toEqual(key);
  });

  it("forgets the context before the session goes, so nothing re-enters it", () => {
    localStorage.setItem("mero:context_id", "ctx-1");
    let atLogout: string | null = "unset";
    signOut(() => {
      atLogout = localStorage.getItem("mero:context_id");
    });
    expect(atLogout).toBeNull();
  });
});
