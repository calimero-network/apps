import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeInvite } from "./inviteCodec";
import { INVITATION_PARAM, invitationUrl } from "./inviteLink";

/**
 * Capture is a module-level singleton wrapping the platform controller, so each
 * test needs a fresh module registry AND a fresh `location`. `vi.resetModules()`
 * plus a dynamic import gives the first; assigning `window.location` before the
 * import gives the second, because the controller reads the URL when it is
 * constructed — which is the whole point of the design and also what makes it
 * awkward to test.
 */
const CODE = encodeInvite({
  invitation: { invitation: { group: "g" }, inviterSignature: "sig" },
  groupAlias: "Engineering standup",
});

function setHref(href: string) {
  // jsdom's `location` is not writable, so replace the descriptor outright.
  Object.defineProperty(window, "location", {
    value: new URL(href) as unknown as Location,
    writable: true,
    configurable: true,
  });
  // The controller only reads `href`; `replaceState` is guarded in the module.
  (window.location as unknown as { href: string }).href = href;
}

async function freshModule() {
  vi.resetModules();
  return import("./invitationIntents");
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invitation capture", () => {
  it("delivers an invitation from the cold-open URL", async () => {
    setHref(`https://app.test/streams?${INVITATION_PARAM}=${CODE}`);
    const { onInvitation } = await freshModule();

    const seen: string[] = [];
    onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([CODE]);
  });

  it("delivers to a listener that subscribes LATE", async () => {
    // The property that makes an app-level mount safe: the intent is buffered
    // until something asks. Without it there is a race between the link arriving
    // and React mounting anything.
    setHref(`https://app.test/?${INVITATION_PARAM}=${CODE}`);
    const { onInvitation } = await freshModule();

    // Nothing subscribed yet — the controller has already captured.
    await new Promise((r) => setTimeout(r, 0));

    const seen: string[] = [];
    onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([CODE]);
  });

  it("reads a full platform link, not just a bare parameter", async () => {
    setHref(invitationUrl(CODE));
    const { onInvitation } = await freshModule();
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([CODE]);
  });

  it("delivers nothing when the URL carries no invitation", async () => {
    setHref("https://app.test/streams");
    const { onInvitation } = await freshModule();
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([]);
  });

  it("ignores another app's invitation", async () => {
    setHref(
      `https://links.calimero.network/com.calimero.chat/join?${INVITATION_PARAM}=${CODE}`,
    );
    const { onInvitation } = await freshModule();
    const seen: string[] = [];
    onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([]);
  });

  it("strips the invitation from the address bar once captured", async () => {
    // Hygiene, not bookkeeping — the platform store is what remembers it. A
    // signed capability left in the URL gets screenshotted or shared on a call.
    const replaceState = vi.spyOn(window.history, "replaceState");
    setHref(`https://app.test/streams?${INVITATION_PARAM}=${CODE}&keep=1`);
    const { onInvitation } = await freshModule();
    onInvitation(() => {});

    expect(replaceState).toHaveBeenCalled();
    const url = String(replaceState.mock.calls[0][2]);
    expect(url).not.toContain(INVITATION_PARAM);
    // and only that parameter
    expect(url).toContain("keep=1");
  });

  it("survives localStorage throwing outright", async () => {
    // Safari in private mode, or a browser configured to block site data. The
    // invitation must still work for this session; only durability is lost.
    const getItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });
    setHref(`https://app.test/?${INVITATION_PARAM}=${CODE}`);
    const { onInvitation } = await freshModule();

    const seen: string[] = [];
    expect(() => onInvitation((i) => seen.push(i.code))).not.toThrow();
    expect(seen).toEqual([CODE]);
    getItem.mockRestore();
  });

  it("does not replay an invitation the app acked", async () => {
    setHref(`https://app.test/?${INVITATION_PARAM}=${CODE}`);
    const { onInvitation, resetInvitationCaptureForTests } =
      await freshModule();

    let captured: { resolve: () => void } | null = null;
    const off = onInvitation((i) => {
      captured = i;
    });
    expect(captured).not.toBeNull();
    captured!.resolve();
    off();
    resetInvitationCaptureForTests();

    // A second controller over the SAME storage must find nothing left.
    setHref("https://app.test/");
    const again = await freshModule();
    const seen: string[] = [];
    again.onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([]);
  });

  it("REPLAYS an invitation the app never acked", async () => {
    // The durability that makes the auth redirect survivable: the app was
    // interrupted before it could handle the invitation, so it comes back.
    setHref(`https://app.test/?${INVITATION_PARAM}=${CODE}`);
    const first = await freshModule();
    first.onInvitation(() => {
      /* deliberately never resolved */
    });
    first.resetInvitationCaptureForTests();

    setHref("https://app.test/");
    const second = await freshModule();
    const seen: string[] = [];
    second.onInvitation((i) => seen.push(i.code));
    expect(seen).toEqual([CODE]);
  });
});
