// Removing someone from a team: next to the role control, asked once, and
// sent with the member's ACCOUNT — the id the member listing returns and
// `useRemoveGroupMembers` takes. The team's last admin is never offered.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ME = "a".repeat(64);
const BEN = "b".repeat(64);

const listGroupMembers = vi.fn();
const removeGroupMembers = vi.fn();
const showToast = vi.fn();

vi.mock("../api/rpc", () => ({
  getNodeIdentity: vi.fn().mockResolvedValue({ accountId: ME }),
  listGroupMembers: (...a: unknown[]) => listGroupMembers(...a),
  rpcCall: vi.fn().mockResolvedValue([]),
  updateMemberRole: vi.fn(),
}));
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => ({ applicationId: "app-1", admin: null }),
  useRemoveGroupMembers: () => ({ removeGroupMembers }),
}));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));

const SettingsSection = (await import("./SettingsSection")).default;

function open() {
  render(<SettingsSection type="team" id="ns1" name="Design" />);
}

describe("SettingsSection – remove member", () => {
  beforeEach(() => {
    listGroupMembers.mockReset();
    removeGroupMembers.mockReset();
    showToast.mockReset();
  });

  it("removes a member by account after a confirm", async () => {
    listGroupMembers.mockResolvedValue({
      members: [{ identity: ME, role: "Admin", name: "Me" }, { identity: BEN, role: "Member", name: "Ben" }],
      teeMembers: [],
    });
    removeGroupMembers.mockResolvedValue(undefined);
    open();

    fireEvent.click(await screen.findByTestId(`remove-member-${BEN}`));
    const dialog = screen.getByTestId("confirm-dialog");
    expect(within(dialog).getByText(/will lose access to Design/)).toBeInTheDocument();
    expect(removeGroupMembers).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("confirm-ok"));
    await waitFor(() => expect(removeGroupMembers).toHaveBeenCalledWith("ns1", { members: [BEN] }));
    await waitFor(() => expect(screen.queryByTestId(`remove-member-${BEN}`)).toBeNull());
    expect(showToast).toHaveBeenCalledWith("Member removed from the team.", "success");
  });

  it("cancelling the confirm removes nobody", async () => {
    listGroupMembers.mockResolvedValue({
      members: [{ identity: ME, role: "Admin" }, { identity: BEN, role: "Member" }],
      teeMembers: [],
    });
    open();
    fireEvent.click(await screen.findByTestId(`remove-member-${BEN}`));
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    expect(removeGroupMembers).not.toHaveBeenCalled();
    expect(screen.getByTestId(`remove-member-${BEN}`)).toBeInTheDocument();
  });

  it("keeps the row and says why when the node refuses", async () => {
    listGroupMembers.mockResolvedValue({
      members: [{ identity: ME, role: "Admin" }, { identity: BEN, role: "Member" }],
      teeMembers: [],
    });
    removeGroupMembers.mockRejectedValue(new Error("not allowed"));
    open();
    fireEvent.click(await screen.findByTestId(`remove-member-${BEN}`));
    fireEvent.click(screen.getByTestId("confirm-ok"));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("not allowed"));
    expect(screen.getByTestId(`remove-member-${BEN}`)).toBeInTheDocument();
  });

  it("offers no Remove on yourself, and none to a non-admin", async () => {
    listGroupMembers.mockResolvedValue({
      members: [{ identity: ME, role: "Member" }, { identity: BEN, role: "Admin" }],
      teeMembers: [],
    });
    open();
    await screen.findByText("Members (2)");
    expect(screen.queryByTestId(`remove-member-${ME}`)).toBeNull();
    expect(screen.queryByTestId(`remove-member-${BEN}`)).toBeNull();
  });
});
