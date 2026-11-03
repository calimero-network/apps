import { describe, it, expect, beforeEach } from "vitest";
import { clearStorageForConnect, CONNECT_PRESERVE_EXACT } from "./index";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";
import { NS_ENTERED_KEY } from "../../utils/session";

describe("clearStorageForConnect", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a pending invitation and the stored passkey session, drops the rest", () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    localStorage.setItem("calimero-session:mero-chat:local", "{}");
    localStorage.setItem("some-stale-session", "junk");

    clearStorageForConnect();

    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok");
    expect(localStorage.getItem("calimero-session:mero-chat:local")).toBe("{}");
    expect(localStorage.getItem("some-stale-session")).toBeNull();
  });

  it("forgets the last-entered workspace, so a fresh sign-in picks one again", () => {
    localStorage.setItem(NS_ENTERED_KEY, "ns-a");
    localStorage.setItem("calimero_group_id", "ns-a");

    clearStorageForConnect();

    expect(localStorage.getItem(NS_ENTERED_KEY)).toBeNull();
    expect(CONNECT_PRESERVE_EXACT.has(NS_ENTERED_KEY)).toBe(false);
  });
});
