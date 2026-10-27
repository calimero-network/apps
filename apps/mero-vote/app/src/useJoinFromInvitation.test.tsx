import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNamespaceJustJoined,
  InvitationDialog,
  isNamespaceJustJoined,
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from "@calimero-apps/cloud";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import {
  APP_SLUG,
  encodeInvitationPayload,
  serializeInvitationPayload,
} from "./utils/invitation";

// The session-aware admin the hook must use: `useMero().admin`. On a node it
// is the node's client; on an account it redeems through the admitter.
const admin = {
  joinNamespace: vi.fn(),
  joinContext: vi.fn(),
  listNamespaces: vi.fn(),
};
// The RAW client's admin, `useMero().mero.admin`. On a delegated session this
// is the relay's node route, which an account's token cannot pass (403). The
// hook must never reach it; these spies exist to prove it does not.
const rawAdmin = {
  joinNamespace: vi.fn(),
  joinContext: vi.fn(),
  listNamespaces: vi.fn(),
};
let isDelegated = false;
const setContextId = vi.fn();

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    isAuthenticated: true,
    isDelegated,
    admin,
    mero: { admin: rawAdmin },
  }),
  setContextId: (id: string) => setContextId(id),
}));

const NAMESPACE = "ns-1";
const CONTEXT = "ctx-1";
const payload = {
  invitation: { invitation: { body: 1 }, inviter_signature: "sig" },
  namespaceId: NAMESPACE,
  contextId: CONTEXT,
} as unknown as Parameters<typeof serializeInvitationPayload>[0];
const TOKEN = encodeInvitationPayload(serializeInvitationPayload(payload));

/** An error shaped like mero-js's HTTPError: the status is what decides. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** The app's in-page open; `undefined` to see the reload fallback. */
let onOpen: ((contextId: string, namespaceId: string) => void) | undefined;
const opened = vi.fn();

function Harness() {
  return (
    <InvitationDialog
      redemption={useJoinFromInvitation({ onOpen })}
      noun="voting group"
    />
  );
}

const reload = vi.fn();
const originalLocation = window.location;

/**
 * Boot the app the way main.tsx does, at `path`, and render the prompt.
 *
 * Capture reads the real location; `reload` is stubbed only afterwards, since
 * jsdom's own cannot be spied on.
 */
function openApp(path: string): void {
  cleanup();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  window.history.replaceState(null, "", path);
  resetInvitationCaptureForTests();
  primeInvitationCapture("mero-vote", { slug: APP_SLUG });
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
  render(<Harness />);
}

/** Open the app from an invitation link and press the dialog's Join. */
async function followLinkAndConfirm(): Promise<void> {
  openApp(`/?invitation=${TOKEN}`);
  fireEvent.click(await screen.findByTestId("invite-accept"));
}

/** Whether the invitation is still held, to be offered on the next open. */
const held = () => peekInvitation() !== null;

/** The stage the dialog is showing. */
const stage = () =>
  screen.getByTestId("invite-prompt").getAttribute("data-stage");

beforeEach(() => {
  vi.clearAllMocks();
  isDelegated = false;
  onOpen = opened;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetInvitationCaptureForTests();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
});

describe("useJoinFromInvitation", () => {
  it("asks first, saying what joining grants", async () => {
    openApp(`/?invitation=${TOKEN}`);

    expect(
      await screen.findByRole("dialog", { name: "Join this voting group?" }),
    ).toBeTruthy();
    expect(stage()).toBe("awaiting-confirmation");
    expect(admin.joinNamespace).not.toHaveBeenCalled();
    // Captured, then taken off the address bar.
    expect(originalLocation.search).not.toContain("invitation");
  });

  it("joins nothing when declined, and does not ask again", async () => {
    openApp(`/?invitation=${TOKEN}`);
    fireEvent.click(await screen.findByTestId("invite-decline"));

    expect(screen.queryByTestId("invite-prompt")).toBeNull();
    expect(admin.joinNamespace).not.toHaveBeenCalled();
    expect(held()).toBe(false);
  });

  it("says so for a link that is not an invitation", async () => {
    openApp("/?invitation=not-an-invitation");

    expect((await screen.findByTestId("invite-error")).textContent).toBe(
      "This invitation link isn't valid. Ask for a new one.",
    );
    expect(admin.joinNamespace).not.toHaveBeenCalled();
    expect(held()).toBe(false);
  });

  it("joins the namespace, then the context, acks, and opens the context in place until it has synced", async () => {
    admin.joinNamespace.mockResolvedValue({});
    admin.joinContext.mockResolvedValue({});
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

    await followLinkAndConfirm();

    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT, NAMESPACE));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace).toHaveBeenCalledWith(NAMESPACE, {
      invitation: payload.invitation,
    });
    expect(admin.joinContext).toHaveBeenCalledWith(CONTEXT);
    expect(admin.joinNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      admin.joinContext.mock.invocationCallOrder[0]!,
    );
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(rawAdmin.joinNamespace).not.toHaveBeenCalled();
    expect(rawAdmin.joinContext).not.toHaveBeenCalled();
    expect(held()).toBe(false);
    // No reload: that would take the dialog down before the polls arrived.
    expect(reload).not.toHaveBeenCalled();

    // Waits on the panel's first read of the polls (its `useJoinSync`)...
    expect(stage()).toBe("syncing");
    expect(isNamespaceJustJoined(NAMESPACE)).toBe(true);
    // ...and says so once that read has come back.
    act(() => clearNamespaceJustJoined(NAMESPACE));
    // The dialog hears the flag clear through a store subscription; wait for
    // the render rather than assume it landed inside this act.
    await waitFor(() => expect(stage()).toBe("ready"));
  });

  it("redeems for an account through the account admin, never the relay's node route", async () => {
    // Seen on prod: `mero.admin.joinNamespace` on a delegated session went to
    // `POST {relay}/admin-api/namespaces/{ns}/join` with the account's bearer
    // token, which has no `namespace:manage` -> 403 -> "refused". The relay
    // would still answer that way, so the raw admin here refuses too; the test
    // passes only if nothing asks it.
    isDelegated = true;
    rawAdmin.joinNamespace.mockRejectedValue(
      httpError(
        403,
        "Token does not carry the permissions this route requires",
      ),
    );
    rawAdmin.joinContext.mockRejectedValue(httpError(403, "forbidden"));
    rawAdmin.listNamespaces.mockRejectedValue(httpError(403, "forbidden"));
    admin.joinNamespace.mockResolvedValue({ namespaceId: NAMESPACE });
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

    await followLinkAndConfirm();

    // An account reloads into the context: the provider builds its relay client
    // for the stored context on mount and cannot switch in place.
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(opened).not.toHaveBeenCalled();
    expect(admin.joinNamespace).toHaveBeenCalledWith(NAMESPACE, {
      invitation: payload.invitation,
    });
    // An account follows the namespace's contexts on joining it, and this
    // app's contexts live directly in the namespace: no second join.
    expect(admin.joinContext).not.toHaveBeenCalled();
    expect(rawAdmin.joinNamespace).not.toHaveBeenCalled();
    expect(rawAdmin.joinContext).not.toHaveBeenCalled();
    expect(rawAdmin.listNamespaces).not.toHaveBeenCalled();
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(screen.queryByTestId("invite-error")).toBeNull();
  });

  it("treats a failed request for a namespace it is now in as joined", async () => {
    // The desktop proxy gives up at 30s; the join lands anyway.
    admin.joinNamespace.mockRejectedValue(httpError(504, "Gateway Timeout"));
    admin.listNamespaces.mockResolvedValue([
      { namespaceId: "other" },
      { namespaceId: NAMESPACE },
    ]);

    await followLinkAndConfirm();

    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT, NAMESPACE));
    // Sent once, never re-sent.
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(screen.queryByText(/Gateway Timeout/)).toBeNull();
    expect(held()).toBe(false);
    // The namespace join landed without answering; the context still has to
    // be joined, or the table opened is one this node is not in.
    expect(admin.joinContext).toHaveBeenCalledWith(CONTEXT);
  });

  // Right after the namespace join the node may not hold the context yet and
  // refuses to join it. That refusal used to be swallowed as "already a member
  // of the namespace": the invitation was spent and the app opened a context
  // the node never joined, so the table never loaded and the link was gone.
  it("keeps joining the context until the node holds it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      admin.joinNamespace.mockResolvedValue({});
      admin.joinContext
        .mockRejectedValueOnce(httpError(404, "context not found"))
        .mockRejectedValueOnce(httpError(404, "context not found"))
        .mockResolvedValue({});
      admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

      await followLinkAndConfirm();
      await vi.advanceTimersByTimeAsync(10_000);

      await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT, NAMESPACE));
      expect(admin.joinContext).toHaveBeenCalledTimes(3);
      expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
      expect(held()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the invitation, and says so, when the context never lets it in", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      admin.joinNamespace.mockResolvedValue({});
      admin.joinContext.mockRejectedValue(httpError(404, "context not found"));
      admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

      await followLinkAndConfirm();
      await vi.advanceTimersByTimeAsync(120_000);

      expect(await screen.findByTestId("invite-retry")).toBeTruthy();
      expect(opened).not.toHaveBeenCalled();
      expect(held()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });


  it("drops an invitation the node refused for good, and says why", async () => {
    admin.joinNamespace.mockRejectedValue(
      httpError(
        409,
        "invitation for group ContextGroupId(Identity([1, 2])) expired at 1759000000",
      ),
    );
    admin.listNamespaces.mockResolvedValue([]);

    await followLinkAndConfirm();

    expect((await screen.findByTestId("invite-error")).textContent).toBe(
      "This invitation has expired. Ask for a new link.",
    );
    expect(screen.queryByTestId("invite-retry")).toBeNull();
    expect(admin.joinContext).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(held()).toBe(false);
  });

  it("keeps an invitation nobody could let in yet, and its retry joins without asking again", async () => {
    admin.joinNamespace.mockRejectedValue(httpError(503, "no online member"));
    admin.listNamespaces.mockResolvedValue([]);

    await followLinkAndConfirm();

    expect((await screen.findByTestId("invite-error")).textContent).toMatch(
      /No one in this voting group is online to let you in yet\./,
    );
    expect(opened).not.toHaveBeenCalled();
    expect(held()).toBe(true);

    admin.joinNamespace.mockResolvedValue({});
    admin.joinContext.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("invite-retry"));

    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT, NAMESPACE));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(2);
    expect(held()).toBe(false);
  });

  it("shows the node's own message when the failure has no better name", async () => {
    admin.joinNamespace.mockRejectedValue(
      httpError(500, "something nobody has seen before"),
    );
    admin.listNamespaces.mockRejectedValue(new Error("list failed"));

    await followLinkAndConfirm();

    expect((await screen.findByTestId("invite-error")).textContent).toBe(
      "something nobody has seen before",
    );
    expect(opened).not.toHaveBeenCalled();
  });

  it("checks membership through the session's admin when the join request failed", async () => {
    isDelegated = true;
    admin.joinNamespace.mockRejectedValue(httpError(504, "Gateway Timeout"));
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);
    rawAdmin.listNamespaces.mockRejectedValue(httpError(403, "forbidden"));

    await followLinkAndConfirm();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(admin.listNamespaces).toHaveBeenCalled();
    expect(rawAdmin.listNamespaces).not.toHaveBeenCalled();
  });
});
