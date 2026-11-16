import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  returnFromConsent: vi.fn(),
  consentIntent: vi.fn(() => ({ kind: "createInvite", org: "org-1" })),
  enterWorkspace: vi.fn(),
  enterJoinedWorkspaceForName: vi.fn(),
  getGroupMetadata: vi.fn(),
  addToast: vi.fn(),
  name: "Ann",
}));

vi.mock("../../api/consent", () => ({ returnFromConsent: h.returnFromConsent, consentIntent: h.consentIntent }));
vi.mock("../../api/platform", () => ({ invalidate: vi.fn() }));
vi.mock("../../api/calimero", () => ({ getAccountId: () => "acct-me" }));
vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class {
    getGroupMetadata = h.getGroupMetadata;
  },
}));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ addToast: h.addToast }) }));
vi.mock("../../utils/enterWorkspace", () => ({
  enterWorkspace: h.enterWorkspace,
  enterJoinedWorkspaceForName: h.enterJoinedWorkspaceForName,
}));
vi.mock("../../utils/messengerName", () => ({ getMessengerDisplayName: () => h.name }));
vi.mock("./GroupInviteModal", () => ({
  default: ({ groupId, initialInvitationPayload }: { groupId: string; initialInvitationPayload: string }) => (
    <div data-testid="invite-modal">
      {groupId}:{initialInvitationPayload}
    </div>
  ),
}));

import ConsentReturn from "./ConsentReturn";
import { INVITATION_STORAGE_KEY } from "../../utils/invitation";

function back() {
  window.history.replaceState(null, "", "/?request_id=r1&result=approved");
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  h.name = "Ann";
  h.consentIntent.mockReturnValue({ kind: "createInvite", org: "org-1" });
  h.getGroupMetadata.mockResolvedValue({ data: { name: "Acme" }, error: null });
  window.history.replaceState(null, "", "/");
});

const approved = (kind: string, outcome: Record<string, string>) => ({
  requestId: "r1",
  kind,
  status: "approved",
  decidedAt: 1,
  outcome,
});

describe("ConsentReturn", () => {
  it("does nothing on a load the consent page did not send back", () => {
    render(<ConsentReturn enabled />);
    expect(h.returnFromConsent).not.toHaveBeenCalled();
  });

  it("leaves a return it kept no intent for to the create-workspace dialog", () => {
    back();
    h.consentIntent.mockReturnValue(null as never);
    render(<ConsentReturn enabled />);
    expect(h.returnFromConsent).not.toHaveBeenCalled();
  });

  it("shows the link of the invite the page minted", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "createInvite", org: "org-1" },
      result: approved("createInvite", { token: "inv-tok" }),
    });
    render(<ConsentReturn enabled />);
    expect(await screen.findByTestId("invite-modal")).toHaveTextContent("org-1:inv-tok");
  });

  it("enters the workspace the page joined, and drops the spent invitation", async () => {
    back();
    localStorage.setItem(INVITATION_STORAGE_KEY, "tok");
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "acceptInvite", org: "org-1" },
      result: approved("acceptInvite", { org: "org-1" }),
    });
    render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.enterWorkspace).toHaveBeenCalledWith(expect.anything(), "org-1", "Ann", "acct-me"));
    expect(localStorage.getItem(INVITATION_STORAGE_KEY)).toBeNull();
  });

  it("says a decline changed nothing, and a return that is not this tab's request too", async () => {
    back();
    h.returnFromConsent.mockResolvedValue({
      intent: { kind: "createInvite", org: "org-1" },
      result: { requestId: "r1", kind: "createInvite", status: "declined", decidedAt: 1 },
    });
    const { unmount } = render(<ConsentReturn enabled />);
    await waitFor(() => expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Not approved" })));
    unmount();

    back();
    h.returnFromConsent.mockRejectedValue(Object.assign(new Error("mismatch"), { code: "CONSENT_REQUEST_MISMATCH" }));
    render(<ConsentReturn enabled />);
    await waitFor(() =>
      expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Nothing was changed" })),
    );
  });
});
