import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupInviteModal from "./GroupInviteModal";

const { mockCreateInvitation } = vi.hoisted(() => ({
  mockCreateInvitation: vi.fn(),
}));

vi.mock("@calimero-network/mero-ui", () => ({
  Button: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("../../api/dataSource/groupApiDataSource", () => ({
  GroupApiDataSource: class MockGroupApiDataSource {
    createInvitation = mockCreateInvitation;
  },
}));

vi.mock("../../utils/invitation", () => ({
  generateInvitationUrl: (token: string) => `https://example.com/?invite=${token}`,
}));

describe("GroupInviteModal", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
  });

  it("renders the modal title and the single invite-link button", () => {
    render(
      <GroupInviteModal
        groupId="12738d49b49b73f5fa471deb839a70c8a939778d3c0e5a2171203f965232a4a4"
        isOpen={true}
        onClose={vi.fn()}
        initialInvitationPayload="invite-payload"
      />,
    );

    expect(screen.getByText(/invite people/i)).toBeInTheDocument();
    // One action: no second "Done" next to the close button.
    expect(screen.queryByRole("button", { name: /^done$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/copy invite link/i)).toBeInTheDocument();
    // The legacy calimero:// "desktop link" is gone — the HTTPS link handles both.
    expect(screen.queryByText(/copy desktop link/i)).not.toBeInTheDocument();
  });

  it("mints an org invite token when it opens and links to it", async () => {
    mockCreateInvitation.mockResolvedValue({
      data: { invitation: "tok-123", groupAlias: "Team Space" },
      error: null,
    });

    render(<GroupInviteModal groupId="org-1" isOpen={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(mockCreateInvitation).toHaveBeenCalledWith("org-1");
    });
    expect(await screen.findByText(/copy invite link/i)).toBeInTheDocument();
  });

  it("says when the link gives Mero Chat only (a shared org)", async () => {
    mockCreateInvitation.mockResolvedValue({
      data: { invitation: "tok-9", groupAlias: "Acme", chatOnly: true },
      error: null,
    });
    render(<GroupInviteModal groupId="org-1" isOpen={true} onClose={vi.fn()} />);
    expect(await screen.findByTestId("invite-single-use")).toHaveTextContent(/Mero Chat only/);
  });

  it("says nothing of the kind for a workspace-wide invite", async () => {
    mockCreateInvitation.mockResolvedValue({ data: { invitation: "tok-1" }, error: null });
    render(<GroupInviteModal groupId="org-1" isOpen={true} onClose={vi.fn()} />);
    expect(await screen.findByText(/copy invite link/i)).toBeInTheDocument();
    expect(screen.getByTestId("invite-single-use")).not.toHaveTextContent(/Mero Chat only/);
  });
});
