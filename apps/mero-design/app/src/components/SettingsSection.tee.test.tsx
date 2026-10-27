// A TEE fleet node is a member row on the node, but not a person. The Settings
// panel must never list or count it, and shows "TEE enabled" instead.

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroupMembers = vi.fn();

vi.mock("../api/rpc", () => ({
  getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "a".repeat(64) }),
  listGroupMembers: (...a: unknown[]) => listGroupMembers(...a),
  rpcCall: vi.fn().mockResolvedValue([]),
  updateMemberRole: vi.fn(),
}));
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ applicationId: "app-1" }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn() }),
}));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const SettingsSection = (await import("./SettingsSection")).default;

const ana = { identity: "a".repeat(64), role: "Admin", name: "Ana" };
const ben = { identity: "b".repeat(64), role: "Member", name: "Ben" };
const replica = { identity: "c".repeat(64), role: "ReadOnlyTee" };
const relay = { identity: "d".repeat(64), role: "RelayTee" };

function open() {
  render(<SettingsSection type="team" id="ns1" name="Design" />);
}

describe("SettingsSection – TEE nodes", () => {
  beforeEach(() => listGroupMembers.mockReset());

  it("counts people only and shows TEE enabled (Relay) when a TEE node is admitted", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana, ben], teeMembers: [replica, relay] });
    open();

    expect(await screen.findByText("Members (2)")).toBeInTheDocument();
    const badge = screen.getByText(/TEE enabled/);
    expect(badge).toHaveTextContent("Relay");
    expect(badge.closest("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("hardware-attested node"),
    );
    expect(screen.queryByTitle(replica.identity)).not.toBeInTheDocument();
  });

  it("shows Replica mode when every TEE node is a read-only replica", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana], teeMembers: [replica] });
    open();

    expect(await screen.findByText(/TEE enabled/)).toHaveTextContent("Replica");
  });

  it("shows no TEE indicator when the group has no TEE node", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana, ben], teeMembers: [] });
    open();

    await waitFor(() => expect(screen.getByText("Members (2)")).toBeInTheDocument());
    expect(screen.queryByText(/TEE enabled/)).not.toBeInTheDocument();
  });
});
