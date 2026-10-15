import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from "@calimero-network/mero-react";
import { WorldInviteError } from "../src/net/admin";
import { encodeInvite } from "../src/net/inviteCodec";
import { APP_SLUG } from "../src/net/inviteLink";
import {
  invitePromptOpen,
  reportWorldLoaded,
  resetInvitePromptForTests,
  setInviteJoiner,
  type InviteJoiner,
} from "../src/ui/invitePrompt";

// ── The invite prompt, as the game drives it ────────────────────────────────
//
// The real capture hears a real `?invitation=` link, and the real
// mero-react dialog renders it into the page; only the screen's join is faked.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
const stage = () => byId("invite-prompt")?.dataset.stage ?? null;
const click = (id: string) => act(async () => byId(id)!.click());

/** Poll until `check` holds, letting React and the join's promises run. */
async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out; dialog stage: ${stage()}`);
    await act(() => new Promise((r) => setTimeout(r, 20)));
  }
}

/** The app opened by a link carrying CODE, as the links page opens it. */
function openLink(): void {
  window.history.replaceState(null, "", `/?invitation=${CODE}`);
  primeInvitationCapture("mero-blocks-test", { slug: APP_SLUG });
}

/** Install a screen's joiner, and let the dialog mount and read the capture. */
async function install(joiner: InviteJoiner | null): Promise<void> {
  await act(async () => setInviteJoiner(joiner));
}

/** Whether the capture still holds the invitation for another attempt. */
const held = () => peekInvitation() !== null;

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
    sessionStorage.clear();
    resetInvitationCaptureForTests();
    resetInvitePromptForTests();
    window.history.replaceState(null, "", "/");
  });
  afterEach(() => {
    act(() => resetInvitePromptForTests());
    resetInvitationCaptureForTests();
  });

  it("asks first, joins on Join, and syncs until the joined world has loaded", async () => {
    const join = vi.fn().mockResolvedValue({ contextId: "ctx-1" });
    openLink();
    await install({ join });

    expect(byId("invite-prompt")!.textContent).toContain("Join “Overworld”?");
    expect(invitePromptOpen()).toBe(true);
    expect(join).not.toHaveBeenCalled();

    await click("invite-accept");
    await until(() => stage() === "syncing");
    expect(join).toHaveBeenCalledWith(
      CODE,
      expect.objectContaining({ contextId: "ctx-1" }),
    );
    expect(held()).toBe(false); // acked: it does not come back

    // Another world loading is not this one arriving.
    act(() => reportWorldLoaded("ctx-other"));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(stage()).toBe("syncing");

    act(() => reportWorldLoaded("ctx-1"));
    await until(() => stage() === "ready");
    await until(() => stage() === null);
    expect(invitePromptOpen()).toBe(false);
  });

  it("holds a link until a screen that can join is up", async () => {
    openLink();
    await install(null);
    expect(byId("invite-prompt")).toBeNull();
    expect(held()).toBe(true);
    await install({ join: vi.fn() });
    expect(byId("invite-accept")).not.toBeNull();
  });

  it("asks again on the next screen about an invitation left unanswered", async () => {
    const onShow = vi.fn();
    openLink();
    await install({ join: vi.fn() });
    await install(null); // e.g. the picker handed over to the game
    expect(byId("invite-prompt")).toBeNull();
    expect(invitePromptOpen()).toBe(false);
    await install({ join: vi.fn(), onShow });
    expect(byId("invite-accept")).not.toBeNull();
    expect(onShow).toHaveBeenCalled(); // the game drops pointer lock under it
  });

  it("Not now joins nothing and stops offering the link", async () => {
    const join = vi.fn();
    openLink();
    await install({ join });
    await click("invite-decline");
    expect(join).not.toHaveBeenCalled();
    expect(byId("invite-prompt")).toBeNull();
    expect(held()).toBe(false);
  });

  it("shows a final failure and lets the link go", async () => {
    openLink();
    await install({ join: vi.fn().mockRejectedValue(failed(false)) });
    await click("invite-accept");
    await until(() => stage() === "failed");
    expect(byId("invite-error")!.textContent).toContain("expired");
    expect(byId("invite-retry")).toBeNull();
    expect(held()).toBe(false);
  });

  it("shows the node's own words for a failure past the namespace join", async () => {
    openLink();
    await install({
      join: vi.fn().mockRejectedValue(new Error("the invite does not reference a world")),
    });
    await click("invite-accept");
    await until(() => stage() === "failed");
    expect(byId("invite-error")!.textContent).toContain("does not reference a world");
    expect(byId("invite-retry")).not.toBeNull();
  });

  it("offers Try again after a failure that may pass, which joins without asking again", async () => {
    const join = vi
      .fn()
      .mockRejectedValueOnce(failed(true))
      .mockResolvedValueOnce({ contextId: "ctx-1" });
    openLink();
    await install({ join });
    await click("invite-accept");
    await until(() => stage() === "failed");
    expect(byId("invite-error")!.textContent).toMatch(/No one in this world is online/);
    expect(held()).toBe(true); // kept for the next load if left unanswered

    await click("invite-retry");
    await until(() => stage() === "syncing");
    expect(join).toHaveBeenCalledTimes(2);
    expect(held()).toBe(false);
  });

  it("says so when the link names the world already being played", async () => {
    openLink();
    await install({ join: vi.fn().mockResolvedValue({ contextId: "ctx-1", already: true }) });
    await click("invite-accept");
    await until(() => stage() === "already-member");
    expect(held()).toBe(false);
  });
});
