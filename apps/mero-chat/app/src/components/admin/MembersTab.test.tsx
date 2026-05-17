import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MembersTab from "./MembersTab";

vi.mock("@calimero-network/mero-ui", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../popups/ConfirmPopup", () => ({
  default: ({ toggle }: { toggle: React.ReactNode }) => <>{toggle}</>,
}));

describe("MembersTab", () => {
  it("does not show the capabilities action for admin members", () => {
    render(
      <MembersTab
        groupId="group-1"
        members={[{ identity: "admin-identity", role: "Admin" }]}
        actionLoading={false}
        onRemoveMember={vi.fn().mockResolvedValue(true)}
        onSetCapabilities={vi.fn().mockResolvedValue(true)}
        onGetCapabilities={vi.fn().mockResolvedValue({ capabilities: 7 })}
        onRefresh={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /capabilities/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the member alias without leaking the raw identity", () => {
    render(
      <MembersTab
        groupId="group-1"
        members={[
          {
            identity: "member-identity-123456789",
            alias: "Alice",
            role: "Member",
          },
        ]}
        actionLoading={false}
        onRemoveMember={vi.fn().mockResolvedValue(true)}
        onSetCapabilities={vi.fn().mockResolvedValue(true)}
        onGetCapabilities={vi.fn().mockResolvedValue({ capabilities: 7 })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Alice")).toHaveLength(2);
    // The truncated identity is no longer displayed as a secondary line —
    // only the alias is visible. Full identity stays in the row's title tip.
    expect(screen.queryByText("member-i...23456789")).not.toBeInTheDocument();
  });

  it("falls back to 'Unnamed member' instead of the identity when no alias", () => {
    render(
      <MembersTab
        groupId="group-1"
        members={[
          {
            identity: "member-identity-no-alias",
            alias: "",
            role: "Member",
          },
        ]}
        actionLoading={false}
        onRemoveMember={vi.fn().mockResolvedValue(true)}
        onSetCapabilities={vi.fn().mockResolvedValue(true)}
        onGetCapabilities={vi.fn().mockResolvedValue({ capabilities: 7 })}
        onRefresh={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Unnamed member").length).toBeGreaterThan(0);
    expect(screen.queryByText("member-i...no-alias")).not.toBeInTheDocument();
  });
});
