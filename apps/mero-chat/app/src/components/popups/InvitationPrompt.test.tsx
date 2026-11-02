import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  joinGroup: vi.fn(),
  getGroupMetadata: vi.fn(),
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
  name: "Alice",
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    joinGroup = h.joinGroup;
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
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.name = "Alice";
  h.joinGroup.mockResolvedValue({ data: { groupId: "org-1", memberIdentity: "acct-me" }, error: null });
  h.getGroupMetadata.mockResolvedValue({ data: { name: "Team" }, error: null });
});

describe("InvitationPrompt", () => {
  it("offers nothing without a pending invitation, or before sign-in", () => {
    const { rerender } = render(<InvitationPrompt enabled />);
    expect(screen.queryByText(/invited/i)).not.toBeInTheDocument();
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    rerender(<InvitationPrompt enabled={false} />);
    expect(screen.queryByText(/invited/i)).not.toBeInTheDocument();
  });

  it("redeems the token on Join and enters the workspace under the stored name", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    await waitFor(() => expect(h.enterWorkspace).toHaveBeenCalled());
    expect(h.joinGroup).toHaveBeenCalledWith({ invitation: "tok" });
    expect(h.enterWorkspace).toHaveBeenCalledWith(expect.anything(), "org-1", "Alice", "acct-me");
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  });

  it("asks for a name first when there is none", async () => {
    h.name = "";
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    await waitFor(() => expect(h.enterJoinedWorkspaceForName).toHaveBeenCalledWith("org-1"));
  });

  it("says why a token could not be redeemed, and keeps it", async () => {
    h.joinGroup.mockResolvedValue({ data: null, error: { code: 404, message: "invite expired" } });
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invite expired");
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok");
  });

  it("Not now drops the invitation", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  });
});
