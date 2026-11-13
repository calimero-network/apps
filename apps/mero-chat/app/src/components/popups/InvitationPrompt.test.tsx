import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  joinGroup: vi.fn(),
  getGroupMetadata: vi.fn(),
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
  name: "Alice",
  myOrgs: vi.fn(),
  bound: false,
  askOnConsentPage: vi.fn(),
}));

vi.mock("../../api/consent", () => ({
  frontendBound: async () => h.bound,
  askOnConsentPage: h.askOnConsentPage,
  consentIntent: () => null,
  consentRequest: (intent: unknown, terms: { inviteToken?: string }) => ({ kind: "acceptInvite", intent, terms }),
}));

vi.mock("../../api/platform", () => ({ myOrgs: h.myOrgs }));
vi.mock("../../api/calimero", () => ({ getAccountId: () => "acct-me" }));

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
import { INVITATION_ORG_STORAGE_KEY, INVITATION_STORAGE_KEY } from "../../utils/invitation";

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.name = "Alice";
  h.bound = false;
  h.askOnConsentPage.mockResolvedValue(false);
  h.joinGroup.mockResolvedValue({ data: { groupId: "org-1", memberIdentity: "acct-me" }, error: null });
  h.getGroupMetadata.mockResolvedValue({ data: { name: "Team" }, error: null });
  h.myOrgs.mockResolvedValue([]);
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

  it("on Chat's frontend, sends Join to the node's consent page and keeps the token until it decides", async () => {
    h.bound = true;
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    localStorage.setItem(INVITATION_ORG_STORAGE_KEY, "org-1");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    await waitFor(() => expect(h.askOnConsentPage).toHaveBeenCalled());
    expect(h.askOnConsentPage.mock.calls[0]?.[0]).toEqual({ kind: "acceptInvite", org: "org-1" });
    expect(h.askOnConsentPage.mock.calls[0]?.[1]).toMatchObject({ terms: { inviteToken: "tok" } });
    expect(h.joinGroup).not.toHaveBeenCalled();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok");
    // Staying here leaves Join on offer.
    expect(await screen.findByRole("button", { name: /join workspace/i })).toBeEnabled();
  });

  it("asks for a name first when there is none", async () => {
    h.name = "";
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    await waitFor(() => expect(h.enterJoinedWorkspaceForName).toHaveBeenCalledWith("org-1"));
  });

  it("says plainly when the invite was already used or has expired, and drops it", async () => {
    h.joinGroup.mockResolvedValue({ data: null, error: { code: 404, message: "unknown invite" } });
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole("button", { name: /join workspace/i })).not.toBeInTheDocument();
  });

  it("says why a token could not be redeemed for now, and keeps it", async () => {
    h.joinGroup.mockResolvedValue({ data: null, error: { code: 503, message: "cluster unavailable" } });
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /join workspace/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("cluster unavailable");
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBe("tok");
  });

  it("does not offer Join to someone already in the workspace, and keeps the link unspent", async () => {
    h.myOrgs.mockResolvedValue([{ orgId: "org-1", name: "Team", role: "owner" }]);
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    localStorage.setItem(INVITATION_ORG_STORAGE_KEY, "org-1");
    render(<InvitationPrompt enabled />);
    expect(await screen.findByText("You're already in this workspace")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join workspace/i })).not.toBeInTheDocument();
    expect(h.joinGroup).not.toHaveBeenCalled();
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /open workspace/i }));
    expect(h.enterWorkspace).toHaveBeenCalledWith(expect.anything(), "org-1", "Alice", "acct-me");
  });

  it("Not now drops the invitation", async () => {
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    render(<InvitationPrompt enabled />);
    fireEvent.click(await screen.findByRole("button", { name: /not now/i }));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  });
});
