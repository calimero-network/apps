// A project's member rows used to show only an account id: board settings read
// names from the subgroup listing, which nobody writes. The name a person set
// for the team lives on the namespace, and every row should show it.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withRoutes } from "@calimero-apps/connect/testing";
import { boardAnswering } from "../test/board";

const ana = "a".repeat(64);

vi.mock("../api/rpc", () => (withRoutes({
  getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "f".repeat(64) }),
  // The project subgroup: rows carry no names.
  listGroupMembers: vi.fn().mockResolvedValue({ members: [{ identity: ana, role: "Member" }], teeMembers: [] }),
  design: boardAnswering([]),
  updateMemberRole: vi.fn(),
  removeTeamMember: vi.fn(),
  // The team's record: the names people set for the whole team.
  readTeam: (...a: unknown[]) => admin.listGroupMembers(...a),
  setTeamName: (...a: unknown[]) => admin.setMemberMetadata?.(...a),
})));
vi.mock("../api/client", () => ({ peekApi: () => ({}) }));
const admin: { listGroupMembers: (...a: unknown[]) => unknown; setMemberMetadata?: (...a: unknown[]) => unknown } = {
  listGroupMembers: (...a: unknown[]) => listTeam(...a),
};
const listTeam = vi.fn().mockResolvedValue({ name: "", roles: new Map(), names: new Map([[ana, "Ana"]]) });
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const SettingsSection = (await import("./SettingsSection")).default;

describe("SettingsSection – member names", () => {
  it("names a project member from the team, not by their account id", async () => {
    render(
      <SettingsSection type="project" id="ctx1" groupId={"1".repeat(64)} namespaceId="ns1" name="Board" />,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(listTeam).toHaveBeenCalledWith("ns1");
  });
});

describe("SettingsSection – your name", () => {
  it("renames you for the whole team, not for one board", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const setMemberMetadata = vi.fn().mockResolvedValue(undefined);
    admin.setMemberMetadata = setMemberMetadata;
    render(<SettingsSection type="team" id="ns1" name="Team" />);
    const input = await screen.findByTestId("your-name-input");
    fireEvent.change(input, { target: { value: "Sandi" } });
    fireEvent.click(screen.getByTestId("your-name-save"));
    await vi.waitFor(() =>
      expect(setMemberMetadata).toHaveBeenCalledWith("ns1", "f".repeat(64), "Sandi"),
    );
  });
});
