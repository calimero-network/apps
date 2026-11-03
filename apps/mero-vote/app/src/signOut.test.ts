import { beforeEach, describe, expect, it, vi } from "vitest";
import { signOut } from "./signOut";
import { THEME_STORAGE_KEY } from "./theme";
import { loadTrusteeKey, saveTrusteeKey } from "./utils/trusteeKeys";

const SELECTION = "mero-vote:group:local:acct-1";

beforeEach(() => localStorage.clear());

describe("signOut", () => {
  it("forgets the open group, ends the session, and keeps the theme and trustee keys", async () => {
    localStorage.setItem(SELECTION, JSON.stringify({ appId: "app-1" }));
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const key = { v: 1 as const, contextId: "app-1", pollId: "poll-1", account: "acc-1", secret: "ab".repeat(32) };
    saveTrusteeKey(key);
    const end = vi.fn(async () => undefined);

    await signOut(end, SELECTION);

    expect(end).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(SELECTION)).toBeNull();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(loadTrusteeKey("app-1", "poll-1", "acc-1")).toEqual(key);
  });

  it("forgets the group before the session goes, so nothing re-enters it", async () => {
    localStorage.setItem(SELECTION, JSON.stringify({ appId: "app-1" }));
    let atEnd: string | null = "unset";
    await signOut(async () => {
      atEnd = localStorage.getItem(SELECTION);
    }, SELECTION);
    expect(atEnd).toBeNull();
  });
});
