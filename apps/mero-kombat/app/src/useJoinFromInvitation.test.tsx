import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepLinkIntent } from "@calimero-network/mero-platform";
import { JoinCard } from "./JoinCard";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { encodeInvitationPayload, serializeInvitationPayload } from "./utils/invitation";

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

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ isAuthenticated: true, isDelegated, admin, mero: { admin: rawAdmin } }),
  setContextId: (id: string) => setContextId(id),
}));

// Capture the deep-link handler so a test can deliver a link the way the
// launcher would.
let deliver: ((intent: DeepLinkIntent) => void) | null = null;
vi.mock("@calimero-network/mero-platform-react", () => ({
  useDeepLink: (handler: (intent: DeepLinkIntent) => void) => {
    deliver = handler;
  },
}));

const NAMESPACE = "ns-1";
const CONTEXT = "ctx-1";
const payload = {
  invitation: { invitation: { body: 1 }, inviter_signature: "sig" },
  namespaceId: NAMESPACE,
  contextId: CONTEXT,
} as unknown as Parameters<typeof serializeInvitationPayload>[0];

/** An error shaped like mero-js's HTTPError: the status is what decides. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function Harness() {
  const { state, redeemPasted, confirmJoin, declineJoin } = useJoinFromInvitation();
  return (
    <JoinCard
      state={state}
      onSubmit={redeemPasted}
      onConfirm={confirmJoin}
      onDecline={declineJoin}
    />
  );
}

/** Deliver a link-borne invitation and press the prompt's Join. */
async function followLinkAndConfirm(): Promise<ReturnType<typeof vi.fn>> {
  const resolve = vi.fn();
  render(<Harness />);
  act(() => {
    deliver?.({
      action: "join",
      params: { invitation: encodeInvitationPayload(serializeInvitationPayload(payload)) },
      resolve,
    } as unknown as DeepLinkIntent);
  });
  // The prompt's Join is the second of the two buttons named "Join".
  const buttons = screen.getAllByRole("button", { name: "Join" });
  fireEvent.click(buttons[buttons.length - 1]!);
  return resolve;
}

const reload = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  vi.clearAllMocks();
  isDelegated = false;
  deliver = null;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
});

describe("useJoinFromInvitation", () => {
  it("joins the namespace, then the context, then acks and reloads", async () => {
    admin.joinNamespace.mockResolvedValue({});
    admin.joinContext.mockResolvedValue({});
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

    const resolve = await followLinkAndConfirm();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace).toHaveBeenCalledWith(NAMESPACE, {
      invitation: payload.invitation,
    });
    expect(admin.joinContext).toHaveBeenCalledWith(CONTEXT);
    expect(admin.joinNamespace.mock.invocationCallOrder[0]).toBeLessThan(
      admin.joinContext.mock.invocationCallOrder[0]!,
    );
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(rawAdmin.joinNamespace).not.toHaveBeenCalled();
    expect(rawAdmin.joinContext).not.toHaveBeenCalled();
  });

  it("redeems for an account through the account admin, never the relay's node route", async () => {
    // Seen on prod: `mero.admin.joinNamespace` on a delegated session went to
    // `POST {relay}/admin-api/namespaces/{ns}/join` with the account's bearer
    // token, which has no `namespace:manage` -> 403 -> "refused". The relay
    // would still answer that way, so the raw admin here refuses too; the test
    // passes only if nothing asks it.
    isDelegated = true;
    rawAdmin.joinNamespace.mockRejectedValue(
      httpError(403, "Token does not carry the permissions this route requires"),
    );
    rawAdmin.joinContext.mockRejectedValue(httpError(403, "forbidden"));
    rawAdmin.listNamespaces.mockRejectedValue(httpError(403, "forbidden"));
    admin.joinNamespace.mockResolvedValue({ namespaceId: NAMESPACE });
    admin.listNamespaces.mockResolvedValue([{ namespaceId: NAMESPACE }]);

    const resolve = await followLinkAndConfirm();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
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
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/can't join/)).toBeNull();
  });

  it("treats a failed request for a namespace it is now in as joined", async () => {
    // The desktop proxy gives up at 30s; the join lands anyway.
    admin.joinNamespace.mockRejectedValue(httpError(504, "Gateway Timeout"));
    admin.listNamespaces.mockResolvedValue([{ namespaceId: "other" }, { namespaceId: NAMESPACE }]);

    const resolve = await followLinkAndConfirm();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // Sent once, never re-sent.
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(setContextId).toHaveBeenCalledWith(CONTEXT);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Gateway Timeout/)).toBeNull();
  });

  it("drops an invitation the node refused for good, and says why", async () => {
    admin.joinNamespace.mockRejectedValue(
      httpError(409, "invitation for group ContextGroupId(Identity([1, 2])) expired at 1759000000"),
    );
    admin.listNamespaces.mockResolvedValue([]);

    const resolve = await followLinkAndConfirm();

    await screen.findByText("This invitation has expired. Ask for a new link.");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(screen.getByText("This invitation cannot succeed; ask for a new one.")).toBeTruthy();
    expect(screen.queryByText(/will be retried/)).toBeNull();
    expect(admin.joinContext).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps an invitation nobody could let in yet, and offers the retry", async () => {
    admin.joinNamespace.mockRejectedValue(httpError(503, "no online member"));
    admin.listNamespaces.mockResolvedValue([]);

    const resolve = await followLinkAndConfirm();

    await screen.findByText(/No one in this namespace is online to let you in yet\./);
    expect(resolve).not.toHaveBeenCalled();
    expect(
      screen.getByText("Kept — this will be retried the next time the app loads."),
    ).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows the node's own message when the failure has no better name", async () => {
    admin.joinNamespace.mockRejectedValue(httpError(500, "something nobody has seen before"));
    admin.listNamespaces.mockRejectedValue(new Error("list failed"));

    const resolve = await followLinkAndConfirm();

    await screen.findByText("something nobody has seen before");
    expect(resolve).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
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
