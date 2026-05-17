import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GroupInviteModal from "./GroupInviteModal";

const { mockCreateInvitation, mockSerializeGroupInvitationPayload } = vi.hoisted(() => ({
  mockCreateInvitation: vi.fn(),
  mockSerializeGroupInvitationPayload: vi.fn(),
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
  generateInvitationDeepLink: (payload: string) => `desktop:${payload}`,
  generateInvitationUrl: (payload: string) => `https://example.com/${payload}`,
  serializeGroupInvitationPayload: mockSerializeGroupInvitationPayload,
}));

describe("GroupInviteModal", () => {
  beforeEach(() => {
    mockCreateInvitation.mockReset();
    mockSerializeGroupInvitationPayload.mockReset();
  });

  it("renders the modal title and copy buttons when given an initial payload", () => {
    render(
      <GroupInviteModal
        groupId="12738d49b49b73f5fa471deb839a70c8a939778d3c0e5a2171203f965232a4a4"
        isOpen={true}
        onClose={vi.fn()}
        initialInvitationPayload="invite-payload"
      />,
    );

    expect(screen.getByText(/invite to workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/copy web link/i)).toBeInTheDocument();
    expect(screen.getByText(/copy desktop link/i)).toBeInTheDocument();
  });

  it("serializes the wrapped invitation payload when it loads an invite", async () => {
    mockCreateInvitation.mockResolvedValue({
      data: {
        invitation: {
          invitation: {
            inviter_identity: "admin",
            group_id: "group-1",
            expiration_height: 42,
            secret_salt: [1, 2, 3],
            protocol: "near",
            network: "testnet",
            contract_id: "contract.testnet",
          },
          inviter_signature: "signature",
        },
        groupAlias: "Team Space",
      },
      error: null,
    });
    mockSerializeGroupInvitationPayload.mockReturnValue("wrapped-payload");

    render(
      <GroupInviteModal
        groupId="group-1"
        isOpen={true}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(mockCreateInvitation).toHaveBeenCalledWith("group-1");
    });

    expect(mockSerializeGroupInvitationPayload).toHaveBeenCalledWith({
      invitation: {
        invitation: {
          inviter_identity: "admin",
          group_id: "group-1",
          expiration_height: 42,
          secret_salt: [1, 2, 3],
          protocol: "near",
          network: "testnet",
          contract_id: "contract.testnet",
        },
        inviter_signature: "signature",
      },
      groupAlias: "Team Space",
    });
  });
});
