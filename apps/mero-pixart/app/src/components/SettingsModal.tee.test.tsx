// A TEE fleet node is a member row on the node, but not a person. The Settings
// modal must never list or count it, and shows "TEE enabled" instead.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroupMembers = vi.fn();

vi.mock("../api/useApi", () => {
  const api = {
    admin: { listGroupMembers: (...a: unknown[]) => listGroupMembers(...a), updateMemberRole: vi.fn() },
    call: vi.fn().mockResolvedValue([]),
    getNodeIdentity: vi.fn().mockResolvedValue({ accountId: "a".repeat(64) }),
  };
  return { useApi: () => api };
});
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue([]) }));
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ applicationId: "app-1" }),
}));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

const SettingsModal = (await import("./SettingsModal")).default;

const NS = "ab".repeat(32);
const ana = { identity: "a".repeat(64), role: "Admin", name: "Ana" };
const ben = { identity: "b".repeat(64), role: "Member", name: "Ben" };
const replica = { identity: "c".repeat(64), role: "ReadOnlyTee" };
const relay = { identity: "d".repeat(64), role: "RelayTee" };

function open() {
  render(<SettingsModal type="team" id={NS} name="Studio" onClose={vi.fn()} />);
}

describe("SettingsModal – TEE nodes", () => {
  beforeEach(() => listGroupMembers.mockReset());

  it("lists and counts people only, and shows TEE enabled (Relay) when a TEE node is admitted", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana, replica, ben, relay] });
    open();

    expect(await screen.findByText("Members (2)")).toBeInTheDocument();
    expect(screen.queryByTitle(replica.identity)).not.toBeInTheDocument();
    expect(screen.queryByTitle(relay.identity)).not.toBeInTheDocument();
    const badge = screen.getByText(/TEE enabled/);
    expect(badge).toHaveTextContent("Relay");
    expect(badge.closest("[title]")).toHaveAttribute(
      "title",
      expect.stringContaining("hardware-attested node"),
    );
  });

  it("shows Replica mode when every TEE node is a read-only replica", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana, replica] });
    open();

    expect(await screen.findByText(/TEE enabled/)).toHaveTextContent("Replica");
    expect(screen.getByText("Members (1)")).toBeInTheDocument();
  });

  it("shows no TEE indicator when the group has no TEE node", async () => {
    listGroupMembers.mockResolvedValue({ members: [ana, ben] });
    open();

    expect(await screen.findByText("Members (2)")).toBeInTheDocument();
    expect(screen.queryByText(/TEE enabled/)).not.toBeInTheDocument();
  });
});
