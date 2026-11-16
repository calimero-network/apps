import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./notificationPermission", () => ({ ensureNotificationPermission: vi.fn(async () => {}) }));

import { enterWorkspace } from "./enterWorkspace";
import { wantsGeneral } from "./landing";
import { getMessengerDisplayName } from "./messengerName";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("enterWorkspace", () => {
  it("publishes your name as your member metadata before the page reloads, and opens #general", async () => {
    let written = false;
    const setMemberMetadata = vi.fn(async () => {
      await Promise.resolve();
      written = true;
      return { data: undefined, error: null };
    });
    await enterWorkspace({ setMemberMetadata }, "org-1", "Ann", "acct-me");
    expect(setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-me", { name: "Ann" });
    expect(written).toBe(true);
    expect(getMessengerDisplayName("org-1")).toBe("Ann");
    expect(wantsGeneral()).toBe(true);
  });

  it("does not write a name the workspace already holds", async () => {
    const setMemberMetadata = vi.fn(async () => ({ data: undefined, error: null }));
    await enterWorkspace({ setMemberMetadata }, "org-1", "Ann", "acct-me", { published: true });
    expect(setMemberMetadata).not.toHaveBeenCalled();
  });

  it("still enters when the node refuses the name", async () => {
    const setMemberMetadata = vi.fn(async () => ({ data: null, error: { code: 403, message: "no" } }));
    await expect(enterWorkspace({ setMemberMetadata } as never, "org-1", "Ann", "acct-me")).resolves.toBeUndefined();
    expect(wantsGeneral()).toBe(true);
  });
});
