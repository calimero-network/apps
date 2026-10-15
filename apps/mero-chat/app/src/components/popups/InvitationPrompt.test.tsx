import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  peekInvitation,
  primeInvitationCapture,
  resetInvitationCaptureForTests,
} from "@calimero-network/mero-react";
import {
  encodeInvitationPayload,
  serializeGroupInvitationPayload,
  APP_SLUG,
} from "../../utils/invitation";
import type { SignedGroupOpenInvitation } from "../../api/groupApi";
import InvitationPrompt from "./InvitationPrompt";

// ── An opened invitation link: asked about, joined, synced, then entered ────
//
// Drives the real shared capture (a cold open of `/?invitation=…`) and the real
// redemption and dialog against a fake node, so what is pinned is the app's own
// part: it asks before joining, holds "Syncing…" until the workspace's channels
// have been read, and only then goes into what was joined.

const h = vi.hoisted(() => ({
  joinGroup: vi.fn(),
  listNamespaces: vi.fn(),
  resolveCurrentMemberIdentity: vi.fn(),
  listSubgroups: vi.fn(),
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
}));

vi.mock("../../api/meroJsClient", () => ({
  getMeroJs: () => ({ admin: { listNamespaces: h.listNamespaces } }),
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    joinGroup = h.joinGroup;
    resolveCurrentMemberIdentity = h.resolveCurrentMemberIdentity;
    listSubgroups = h.listSubgroups;
    setGroupMetadata = () => Promise.resolve({ data: null, error: null });
    syncGroup = () => Promise.resolve({ data: null, error: null });
  },
}));

// Entering reloads the page; what matters is where to.
vi.mock("../../utils/enterWorkspace", () => ({
  enterWorkspace: h.enterWorkspace,
  enterJoinedWorkspaceForName: h.enterJoinedWorkspaceForName,
}));

const failure = (code: number, message: string) =>
  Promise.resolve({ data: null, error: { code, message } });

const TOKEN = encodeInvitationPayload(
  serializeGroupInvitationPayload({
    invitation: {
      invitation: { group_id: "ns1" },
      inviter_signature: "sig",
    } as unknown as SignedGroupOpenInvitation,
    groupAlias: "Team",
  }),
);

/** A cold open of the link, as the links page hands it to the app. */
function openLink(enabled = true) {
  window.history.replaceState(null, "", `/?invitation=${TOKEN}`);
  primeInvitationCapture("mero-chat", { slug: APP_SLUG });
  return render(<InvitationPrompt enabled={enabled} />);
}

/** Entering waits for the dialog: synced, then "You're in" for a beat. */
const ENTERED = { timeout: 4_000 };

beforeEach(() => {
  resetInvitationCaptureForTests();
  localStorage.clear();
  sessionStorage.clear();
  h.listSubgroups.mockReset().mockResolvedValue({ data: [], error: null });
  h.joinGroup.mockReset().mockResolvedValue({
    data: { groupId: "ns1", memberIdentity: "me" },
  });
  h.listNamespaces.mockReset().mockResolvedValue([{ namespaceId: "ns1" }]);
  h.resolveCurrentMemberIdentity
    .mockReset()
    .mockResolvedValue({ data: { memberIdentity: "me", members: [] } });
  h.enterWorkspace.mockReset();
  h.enterJoinedWorkspaceForName.mockReset();
});

afterEach(() => {
  resetInvitationCaptureForTests();
  window.history.replaceState(null, "", "/");
});

describe("InvitationPrompt", () => {
  it("asks, naming the workspace, and does not join until Join is clicked", async () => {
    openLink();
    expect(
      await screen.findByRole("dialog", { name: "Join “Team”?" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invite-decline")).toBeInTheDocument();
    expect(h.joinGroup).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("invite-accept"));
    await waitFor(() => expect(h.joinGroup).toHaveBeenCalledTimes(1));
  });

  it("joins nothing when declined", async () => {
    openLink();
    fireEvent.click(await screen.findByTestId("invite-decline"));
    await waitFor(() =>
      expect(screen.queryByTestId("invite-prompt")).not.toBeInTheDocument(),
    );
    expect(peekInvitation()).toBeNull();
    expect(h.joinGroup).not.toHaveBeenCalled();
  });

  it("holds the invitation until the session can join", async () => {
    const view = openLink(false);
    await act(async () => {});
    expect(screen.queryByTestId("invite-accept")).not.toBeInTheDocument();

    view.rerender(<InvitationPrompt enabled />);
    expect(await screen.findByTestId("invite-accept")).toBeInTheDocument();
  });

  it("goes straight into the joined workspace when a display name is chosen", async () => {
    localStorage.setItem("chat-username", "Bob");
    openLink();
    fireEvent.click(await screen.findByTestId("invite-accept"));
    await waitFor(
      () =>
        expect(h.enterWorkspace).toHaveBeenCalledWith(
          expect.anything(),
          "ns1",
          "Bob",
          "me",
        ),
      ENTERED,
    );
    expect(h.listSubgroups).toHaveBeenCalledWith("ns1");
    expect(h.enterJoinedWorkspaceForName).not.toHaveBeenCalled();
  });

  it("hands the joined workspace to the name step when no name is chosen yet", async () => {
    openLink();
    fireEvent.click(await screen.findByTestId("invite-accept"));
    await waitFor(
      () => expect(h.enterJoinedWorkspaceForName).toHaveBeenCalledWith("ns1"),
      ENTERED,
    );
    expect(h.enterWorkspace).not.toHaveBeenCalled();
  });

  it("looks the identity up when the join never answered but landed", async () => {
    h.joinGroup.mockReturnValue(failure(500, "The request was aborted"));
    openLink();
    fireEvent.click(await screen.findByTestId("invite-accept"));
    // Settled against the namespace list, so the node already held it: the
    // dialog says so and goes in on "Done".
    fireEvent.click(await screen.findByTestId("invite-done"));
    await waitFor(() =>
      expect(h.enterJoinedWorkspaceForName).toHaveBeenCalledWith("ns1"),
    );
    expect(h.resolveCurrentMemberIdentity.mock.calls[0]?.[0]).toBe("ns1");
  });

  it("stays on syncing, and does not go in, until the channels have been read", async () => {
    localStorage.setItem("chat-username", "Bob");
    h.listSubgroups.mockResolvedValue({
      data: null,
      error: { code: 503, message: "not synced yet" },
    });
    openLink();
    fireEvent.click(await screen.findByTestId("invite-accept"));
    await waitFor(() =>
      expect(screen.getByTestId("invite-prompt")).toHaveAttribute(
        "data-stage",
        "syncing",
      ),
    );
    expect(peekInvitation()).toBeNull();
    await waitFor(() => expect(h.listSubgroups).toHaveBeenCalled());
    expect(h.enterWorkspace).not.toHaveBeenCalled();
  });

  it("says why a refused invitation did not join, and goes nowhere", async () => {
    h.joinGroup.mockReturnValue(failure(409, "member was removed"));
    h.listNamespaces.mockResolvedValue([]);
    openLink();
    fireEvent.click(await screen.findByTestId("invite-accept"));
    expect(await screen.findByTestId("invite-error")).toHaveTextContent(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
    expect(peekInvitation()).toBeNull();
    expect(screen.queryByTestId("invite-retry")).not.toBeInTheDocument();
    expect(h.enterWorkspace).not.toHaveBeenCalled();
    expect(h.enterJoinedWorkspaceForName).not.toHaveBeenCalled();
  });
});
