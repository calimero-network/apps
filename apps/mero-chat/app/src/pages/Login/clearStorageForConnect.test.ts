import { describe, it, expect, beforeEach } from "vitest";
import { clearStorageForConnect, CONNECT_PRESERVE_EXACT } from "./index";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";

describe("clearStorageForConnect", () => {
  beforeEach(() => localStorage.clear());

  it("preserves the pending invitation across a fresh Connect", () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "encoded-invite");
    localStorage.setItem("some-stale-session", "junk");
    localStorage.setItem("mero:node_url", "http://localhost:2528");

    clearStorageForConnect();

    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("encoded-invite");
    expect(localStorage.getItem("mero:node_url")).toBe("http://localhost:2528");
    expect(localStorage.getItem("some-stale-session")).toBeNull();
  });

  it("keeps the invitation key in the preserve whitelist", () => {
    expect(CONNECT_PRESERVE_EXACT.has(INVITATION_STORAGE_KEY)).toBe(true);
  });
});
