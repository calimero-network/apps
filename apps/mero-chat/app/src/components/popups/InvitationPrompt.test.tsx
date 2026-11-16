import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError } from "@calimero-network/mero-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getGroupMetadata: vi.fn(),
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
  name: "Alice",
  invalidate: vi.fn(),
  dialog: vi.fn(),
}));

vi.mock("../../api/platform", () => ({ invalidate: h.invalidate }));
vi.mock("../../api/calimero", () => ({
  getAccountId: () => "acct-me",
  passkey: () => ({ id: "pk" }),
  useCalimero: () => ({ session: { status: "signed-in", client: { id: "client" } } }),
}));
vi.mock("@calimero-network/mero-react", () => ({
  AcceptInviteDialog: (p: {
    open: boolean;
    onClose: () => void;
    onJoined: (j: { org: string }) => void;
    onError: (e: unknown) => void;
  }) => {
    h.dialog(p);
    return p.open ? (
      <div>
        <button onClick={() => void p.onJoined({ org: "org-1" })}>Join</button>
        <button onClick={p.onClose}>Close dialog</button>
        <button onClick={() => p.onError(new CalimeroError(400, "REJECTED", "this invite has expired"))}>Spent</button>
        <button onClick={() => p.onError(new CalimeroError(401, "UNAUTHORIZED", "session expired"))}>Lapsed</button>
      </div>
    ) : null;
  },
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    getGroupMetadata = h.getGroupMetadata;
  },
}));
vi.mock("../../utils/enterWorkspace", () => ({
  enterWorkspace: h.enterWorkspace,
  enterJoinedWorkspaceForName: h.enterJoinedWorkspaceForName,
}));
vi.mock("../../utils/messengerName", () => ({
  getMessengerDisplayName: () => h.name,
}));

import InvitationPrompt from "./InvitationPrompt";
import { INVITATION_ORG_STORAGE_KEY, INVITATION_STORAGE_KEY } from "../../utils/invitation";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.name = "Alice";
  h.getGroupMetadata.mockResolvedValue({ data: { name: "Team" }, error: null });
});

describe("InvitationPrompt", () => {
  it("offers nothing without a pending invitation, or before sign-in", () => {
    const { rerender } = render(<InvitationPrompt enabled />);
    expect(h.dialog).not.toHaveBeenCalled();
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    rerender(<InvitationPrompt enabled={false} />);
    expect(h.dialog).not.toHaveBeenCalled();
  });

  it("hands the shared dialog the stored token and Chat's session", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    await screen.findByRole("button", { name: "Join" });
    expect(h.dialog.mock.calls.at(-1)![0]).toMatchObject({
      open: true,
      token: "tok",
      appName: "Hyperfeed Chat",
      client: { id: "client" },
      passkey: { id: "pk" },
    });
  });

  it("once joined, enters the workspace under the stored name and drops the token", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await waitFor(() => expect(h.enterWorkspace).toHaveBeenCalled());
    expect(h.enterWorkspace).toHaveBeenCalledWith(expect.anything(), "org-1", "Alice", "acct-me");
    expect(h.invalidate).toHaveBeenCalled();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: "Join" })).not.toBeInTheDocument();
  });

  it("asks for a name first when there is none", async () => {
    h.name = "";
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Join" }));
    await waitFor(() => expect(h.enterJoinedWorkspaceForName).toHaveBeenCalledWith("org-1"));
  });

  it("names the invite's workspace to the dialog and restores Chat's wording", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    localStorage.setItem(INVITATION_ORG_STORAGE_KEY, "org-1");
    render(<InvitationPrompt enabled />);
    await screen.findByRole("button", { name: "Join" });
    expect(h.dialog.mock.calls.at(-1)![0]).toMatchObject({
      org: "org-1",
      labels: { title: "You're invited to a workspace", join: "Join workspace" },
    });
  });

  it("names no org for a link that names none", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    await screen.findByRole("button", { name: "Join" });
    expect(h.dialog.mock.calls.at(-1)![0].org).toBeUndefined();
  });

  it("drops the stored token when the node says it is spent, and keeps the dialog up", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Spent" }));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Join" })).toBeInTheDocument();
  });

  it("keeps the stored token when the failure is a lapsed session", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Lapsed" }));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok");
  });

  it("closing the dialog drops the invitation", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: "Close dialog" }));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  });
});
