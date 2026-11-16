import { beforeEach, describe, expect, it } from "vitest";
import {
  INVITATION_STORAGE_KEY,
  captureInvite,
  dropInvite,
  parseInvitationInput,
  pendingInvite,
  pendingInviteOrg,
} from "./invitation";

beforeEach(() => localStorage.clear());

describe("invitation links", () => {
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

  it("name their workspace, which is captured with the token and dropped with it", () => {
    window.history.replaceState(null, "", "/?invite=tok-4&org=org-1");
    captureInvite();
    expect(pendingInviteOrg()).toBe("org-1");
    expect(window.location.search).toBe("");
    dropInvite();
    expect(pendingInviteOrg()).toBeNull();
  });

  it("are captured from the shared dialog's link, which carries the token in the fragment", () => {
    window.history.replaceState(null, "", "/?org=org-5&x=1#invite=tok-5");
    captureInvite();
    expect(pendingInvite()).toBe("tok-5");
    expect(pendingInviteOrg()).toBe("org-5");
    expect(window.location.search).toBe("?x=1");
    expect(window.location.hash).toBe("");
  });
});
