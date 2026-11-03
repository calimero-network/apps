import { beforeEach, describe, expect, it } from "vitest";
import {
  INVITATION_STORAGE_KEY,
  captureInvite,
  dropInvite,
  generateInvitationUrl,
  parseInvitationInput,
  pendingInvite,
} from "./invitation";

beforeEach(() => localStorage.clear());

describe("invitation links", () => {
  it("open this frontend with the org invite token", () => {
    expect(generateInvitationUrl("tok-1", { origin: "https://chat.example", pathname: "/" })).toBe(
      "https://chat.example/?invite=tok-1",
    );
  });

  it("read a token from a pasted link or a bare token", () => {
    expect(parseInvitationInput("https://chat.example/?invite=tok-1")).toBe("tok-1");
    expect(parseInvitationInput("  tok-2 ")).toBe("tok-2");
    expect(parseInvitationInput("https://chat.example/")).toBeNull();
    expect(parseInvitationInput("")).toBeNull();
  });

  it("are captured off the address bar before sign-in, and dropped once used", () => {
    window.history.replaceState(null, "", "/?invite=tok-3&x=1");
    captureInvite();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok-3");
    expect(window.location.search).toBe("?x=1");
    expect(pendingInvite()).toBe("tok-3");
    dropInvite();
    expect(pendingInvite()).toBeNull();
  });
});
