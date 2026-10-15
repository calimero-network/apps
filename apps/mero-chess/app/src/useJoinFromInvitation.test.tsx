import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import {
  APP_SLUG,
  encodeInvitationPayload,
  serializeInvitationPayload,
} from "./utils/invitation";

// ── The invitation dialog, driven from a real `?invitation=` link ───────────
//
// Capture, the dialog and the keep-or-drop decision are mero-react's and
// mero-js's own; only the session is faked. So what is acked, what is offered
// again, and what the dialog says are the real answers to the node's status.

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

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    isAuthenticated: true,
    isDelegated,
    admin,
    mero: { admin: rawAdmin },
  }),
  setContextId: (id: string) => setContextId(id),
}));

const {
  InvitationDialog,
  clearNamespaceJustJoined,
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} = await import("@calimero-network/mero-react");

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

/** Where the app was told to open the joined context. */
const opened = vi.fn();

function Harness() {
  return (
    <InvitationDialog
      redemption={useJoinFromInvitation(opened)}
      noun="namespace"
    />
  );
}

/** Boot the app the way main.tsx does, at `path`, and mount the dialog. */
function openApp(path: string): void {
  cleanup();
  window.history.replaceState(null, "", path);
  resetInvitationCaptureForTests();
  primeInvitationCapture("mero-chess", { slug: APP_SLUG });
  render(<Harness />);
}

/** Open the app from an invitation link and press the dialog's Join. */
async function followLinkAndConfirm(): Promise<void> {
  openApp(`/?invitation=${TOKEN}`);
  fireEvent.click(await screen.findByTestId("invite-accept"));
}

/** Whether the invitation is still held for another attempt. */
const held = () => peekInvitation() !== null;

const stage = () =>
  screen.queryByTestId("invite-prompt")?.getAttribute("data-stage") ?? null;

beforeEach(() => {
  vi.clearAllMocks();
  isDelegated = false;
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  resetInvitationCaptureForTests();
  window.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
});

describe("useJoinFromInvitation", () => {
  it("asks first, showing what joining adds this node to", async () => {
    openApp(`/?invitation=${TOKEN}`);

    await screen.findByTestId("invite-accept");
    expect(stage()).toBe("awaiting-confirmation");
    expect(admin.joinNamespace).not.toHaveBeenCalled();
    // Captured, then taken off the address bar.
    expect(window.location.search).not.toContain("invitation");
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

  it("joins the namespace, then the context, opens it in place, and waits for its data", async () => {
    admin.joinNamespace.mockResolvedValue({});
    admin.joinContext.mockResolvedValue({});
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

    await followLinkAndConfirm();

    await waitFor(() => expect(stage()).toBe("syncing"));
    expect(opened).toHaveBeenCalledWith(CONTEXT);
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(held()).toBe(false);
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace).toHaveBeenCalledWith(NAMESPACE, {
      invitation: payload.invitation,
    });
    expect(admin.joinContext).toHaveBeenCalledWith(CONTEXT);
    expect(admin.joinNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      admin.joinContext.mock.invocationCallOrder[0]!,
    );
    expect(rawAdmin.joinNamespace).not.toHaveBeenCalled();
    expect(rawAdmin.joinContext).not.toHaveBeenCalled();

    // The table page's first read of the table is what lets the dialog go.
    act(() => clearNamespaceJustJoined(NAMESPACE));
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

    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT));
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

    await waitFor(() => expect(opened).toHaveBeenCalledWith(CONTEXT));
    // Sent once, never re-sent.
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(held()).toBe(false);
    expect(screen.queryByText(/Gateway Timeout/)).toBeNull();
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
    expect(held()).toBe(false);
  });

  it("keeps an invitation nobody could let in yet, and the retry joins without asking again", async () => {
    admin.joinNamespace.mockRejectedValue(httpError(503, "no online member"));
    admin.listNamespaces.mockResolvedValue([]);

    await followLinkAndConfirm();

    expect((await screen.findByTestId("invite-error")).textContent).toMatch(
      /No one in this namespace is online to let you in yet\./,
    );
    expect(opened).not.toHaveBeenCalled();
    expect(held()).toBe(true);

    admin.joinNamespace.mockResolvedValue({});
    admin.joinContext.mockResolvedValue({});
    fireEvent.click(screen.getByTestId("invite-retry"));
    await waitFor(() => expect(held()).toBe(false));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(2);
    expect(opened).toHaveBeenCalledWith(CONTEXT);
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

    await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
    expect(admin.listNamespaces).toHaveBeenCalled();
    expect(rawAdmin.listNamespaces).not.toHaveBeenCalled();
  });
});
