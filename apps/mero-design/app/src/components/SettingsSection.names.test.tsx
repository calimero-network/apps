// A project's member rows used to show only an account id: board settings read
// names from the subgroup listing, which nobody writes. The name a person set
// for the team lives on the namespace, and every row should show it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const ana = "a".repeat(64);

vi.mock("../api/rpc", () => ({
  getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "f".repeat(64) }),
  // The project subgroup: rows carry no names.
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: ana, role: "Member" }], teeMembers: [] }),
  rpcCall: vi.fn().mockResolvedValue([]),
  updateMemberRole: vi.fn(),
}));
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
// The namespace listing, read through the session admin.
const admin: { listGroupMembers: ReturnType<typeof vi.fn>; setMemberMetadata?: ReturnType<typeof vi.fn> } = {
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: ana, role: "Member", name: "Ana" }] }),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ applicationId: "app-1", admin }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn() }),
}));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const SettingsSection = (await import("./SettingsSection")).default;

describe("SettingsSection – member names", () => {
  it("names a project member from the team, not by their account id", async () => {
    render(
      <SettingsSection type="project" id="ctx1" groupId={"1".repeat(64)} namespaceId="ns1" name="Board" />,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(admin.listGroupMembers).toHaveBeenCalledWith("ns1");
  });
});

describe("SettingsSection – your name", () => {
  it("renames you for the whole team, not for one board", async () => {
    const { fireEvent } = await import("@testing-library/react");
    admin.setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    render(<SettingsSection type="team" id="ns1" name="Team" />);
    const input = await screen.findByTestId("your-name-input");
    fireEvent.change(input, { target: { value: "Sandi" } });
    fireEvent.click(screen.getByTestId("your-name-save"));
    await vi.waitFor(() =>
      expect(admin.setMemberMetadata).toHaveBeenCalledWith("ns1", "f".repeat(64), { name: "Sandi" }),
    );
  });
});
