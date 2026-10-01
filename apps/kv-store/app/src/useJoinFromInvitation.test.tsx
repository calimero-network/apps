import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepLinkIntent } from "@calimero-network/mero-platform";
import { JoinCard } from "./JoinCard";
import { useJoinFromInvitation } from "./useJoinFromInvitation";
import { encodeInvitationPayload, serializeInvitationPayload } from "./utils/invitation";

// The node, as the hook reaches it: the admin client on `useMero().mero`.
const admin = {
  joinNamespace: vi.fn(),
  joinContext: vi.fn(),
  listNamespaces: vi.fn(),
};
const setContextId = vi.fn();

// `useJoinInvitation`'s redeemer as mero-react builds it for a node login: join
// the namespace then the context on the node, and read its namespaces back.
type JoinInput = { namespaceId: string; contextId: string; invitation: unknown };
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ isAuthenticated: true, mero: { admin } }),
  setContextId: (id: string) => setContextId(id),
  useJoinInvitation: () => ({
    invitationRedeemer: (input: JoinInput) => ({
      join: async () => {
        await admin.joinNamespace(input.namespaceId, { invitation: input.invitation });
        await admin.joinContext(input.contextId);
      },
      memberships: async () =>
        ((await admin.listNamespaces()) as Array<{ namespaceId?: string; groupId?: string; id?: string }>).map(
          (n) => n.namespaceId ?? n.groupId ?? n.id ?? "",
        ),
    }),
  }),
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
});
