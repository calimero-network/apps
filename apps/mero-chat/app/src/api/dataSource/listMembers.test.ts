import { describe, expect, it, vi } from "vitest";

const { mockListGroupMembers } = vi.hoisted(() => ({ mockListGroupMembers: vi.fn() }));

vi.mock("@calimero-network/mero-react", () => ({ getNodeUrl: () => "http://localhost:2428" }));
vi.mock("../meroJsClient", () => ({
  getAuthConfig: () => ({ jwtToken: "token" }),
  getMeroJs: () => ({ admin: { listGroupMembers: mockListGroupMembers } }),
}));

import { GroupApiDataSource } from "./groupApiDataSource";

describe("GroupApiDataSource.listMembers", () => {
  // A relay or replica holds a TEE role in the group, but it is a node the
  // workspace runs on, not a person: the DM picker, member lists and avatars
  // all read this, and each offered to message a machine.
  it("lists the people in the group, never its TEE nodes", async () => {
    mockListGroupMembers.mockResolvedValue({
      members: [
        { identity: "admin-1", role: "Admin", name: "Nora" },
        { identity: "relay-1", role: "RelayTee" },
        { identity: "member-1", role: "Member", name: "Xabi" },
        { identity: "replica-1", role: "ReadOnlyTee" },
        { identity: "reader-1", role: "ReadOnly" },
      ],
    });
    const res = await new GroupApiDataSource().listMembers("group-tee-filter");
    expect(res.data?.members.map((m) => m.identity)).toEqual(["admin-1", "member-1", "reader-1"]);
  });
});
