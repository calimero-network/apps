import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  onInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from "@calimero-apps/invite";
import { WorldInviteError } from "../src/net/admin";
import { encodeInvite } from "../src/net/inviteCodec";
import { APP_SLUG } from "../src/net/inviteLink";
import {
  invitePromptOpen,
  resetInvitePromptForTests,
  setInviteJoiner,
} from "../src/ui/invitePrompt";

const CODE = encodeInvite({
  invitation: {
    invitation: { groupId: [0xab, 0xcd] },
    inviterSignature: "sig",
  },
  groupAlias: "Overworld",
  contextId: "ctx-1",
  groupId: "grp-1",
});

const byId = (id: string) =>
  document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => byId(id)!.click();
const settle = () => new Promise((r) => setTimeout(r, 0));

/** The app opened by a link carrying CODE, as the links page opens it. */
function openLink(): void {
  window.history.replaceState(null, "", `/?invitation=${CODE}`);
  primeInvitationCapture("merraria-test", { slug: APP_SLUG });
}

/** Whether the capture still holds the invitation (it is not acked). */
function stillCaptured(): boolean {
  resetInvitationCaptureForTests();
  const seen: string[] = [];
  onInvitation((i) => seen.push(i.token));
  return seen.includes(CODE);
}

function failed(retryable: boolean): WorldInviteError {
  return new WorldInviteError({
    status: "failed",
    namespaceId: null,
    message: retryable ? "no peers" : "expired",
    reason: retryable ? "no-one-online" : "expired",
    retryable,
  });
}

describe("invite prompt", () => {
  beforeEach(() => {
    localStorage.clear();
    resetInvitationCaptureForTests();
    resetInvitePromptForTests();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    resetInvitePromptForTests();
    resetInvitationCaptureForTests();
  });

  it("asks before joining, naming the world, and joins only on Join", async () => {
    const join = vi.fn().mockResolvedValue(undefined);
    openLink();
    setInviteJoiner({ join });

    expect(byId("invite-status")!.textContent).toContain("Overworld");
    expect(join).not.toHaveBeenCalled();

    click("invite-accept");
    await settle();
    expect(join).toHaveBeenCalledWith(
      CODE,
      expect.objectContaining({ contextId: "ctx-1" }),
    );
    expect(invitePromptOpen()).toBe(false);
    expect(stillCaptured()).toBe(false); // acked: it does not come back
  });

  it("holds a link until a screen that can join is up", () => {
    openLink();
    expect(invitePromptOpen()).toBe(false);
    setInviteJoiner({ join: vi.fn() });
    expect(byId("invite-accept")).not.toBeNull();
  });

  it("offers an unanswered invitation again on the next screen", () => {
    openLink();
    setInviteJoiner({ join: vi.fn() });
    setInviteJoiner(null); // e.g. the picker handed over to the game
    expect(invitePromptOpen()).toBe(false);
    setInviteJoiner({ join: vi.fn() });
    expect(byId("invite-accept")).not.toBeNull();
  });

  it("Not now joins nothing and stops offering the link", () => {
    const join = vi.fn();
    openLink();
    setInviteJoiner({ join });
    click("invite-decline");
    expect(join).not.toHaveBeenCalled();
    expect(invitePromptOpen()).toBe(false);
    expect(stillCaptured()).toBe(false);
  });

  it("shows a final failure and lets the link go", async () => {
    openLink();
    setInviteJoiner({ join: vi.fn().mockRejectedValue(failed(false)) });
    click("invite-accept");
    await settle();
    expect(byId("invite-error")!.textContent).toContain("expired");
    expect(byId("invite-retry")).toBeNull();
    expect(stillCaptured()).toBe(false);
  });

  it("offers Try again after a failure that may pass, and keeps the link", async () => {
    const join = vi
      .fn()
      .mockRejectedValueOnce(failed(true))
      .mockResolvedValueOnce(undefined);
    openLink();
    setInviteJoiner({ join });
    click("invite-accept");
    await settle();
    expect(byId("invite-error")!.textContent).toMatch(
      /No one in this world is online/,
    );

    click("invite-retry");
    await settle();
    expect(join).toHaveBeenCalledTimes(2);
    expect(invitePromptOpen()).toBe(false);
  });

  it("keeps a link whose transient failure was left unanswered", async () => {
    openLink();
    setInviteJoiner({ join: vi.fn().mockRejectedValue(failed(true)) });
    click("invite-accept");
    await settle();
    expect(stillCaptured()).toBe(true);
  });
});
