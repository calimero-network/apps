import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsTab from "./SettingsTab";
import type { GroupInfo, GroupMember } from "../../api/groupApi";

const baseGroup: GroupInfo = {
  groupId: "group-abc-123",
  appKey: "app-key",
  targetApplicationId: "target-app-id",
  upgradePolicy: "LazyOnAccess",
  memberCount: 5,
  contextCount: 3,
  activeUpgrade: null,
  defaultCapabilities: 2,
  subgroupVisibility: "open",
};

describe("SettingsTab", () => {
  it("renders group info fields including the subgroup count", () => {
    render(
      <SettingsTab
        groupId="group-abc-123"
        group={baseGroup}
        subgroupCount={7}
        actionLoading={false}
        onSetDefaultCapabilities={vi.fn()}
        onSetSubgroupVisibility={vi.fn()}
      />,
    );

    expect(screen.getByText(/group info/i)).toBeInTheDocument();
    expect(screen.getByText("group-abc-123")).toBeInTheDocument();
    expect(screen.getByText("target-app-id")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument(); // memberCount
    expect(screen.getByText("Subgroups")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument(); // subgroupCount
    expect(screen.getByText("LazyOnAccess")).toBeInTheDocument();
  });

  it("shows a dash when the subgroup count is not yet loaded", () => {
    render(
      <SettingsTab
        groupId="group-abc-123"
        group={baseGroup}
        subgroupCount={null}
        actionLoading={false}
        onSetDefaultCapabilities={vi.fn()}
        onSetSubgroupVisibility={vi.fn()}
      />,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows empty state when group is null", () => {
    render(
      <SettingsTab
        groupId="group-abc-123"
        group={null}
        subgroupCount={null}
        actionLoading={false}
        onSetDefaultCapabilities={vi.fn()}
        onSetSubgroupVisibility={vi.fn()}
      />,
    );

    expect(screen.getByText(/no group data available/i)).toBeInTheDocument();
  });

  describe("confidential compute", () => {
    const relay: GroupMember = { identity: "cb62" + "0".repeat(56) + "4c3c", role: "RelayTee" };
    const replica: GroupMember = { identity: "7e10" + "1".repeat(56) + "b902", role: "ReadOnlyTee" };

    const renderWith = (teeMembers: GroupMember[]) =>
      render(
        <SettingsTab
          groupId="group-abc-123"
          group={baseGroup}
          subgroupCount={7}
          teeMembers={teeMembers}
          actionLoading={false}
          onSetDefaultCapabilities={vi.fn()}
          onSetSubgroupVisibility={vi.fn()}
        />,
      );

    it("says TEE is not enabled when the namespace has no TEE node", () => {
      renderWith([]);

      expect(screen.getByText(/confidential compute/i)).toBeInTheDocument();
      expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
    });

    it("shows Relay mode and the node id when a relay TEE is admitted", () => {
      renderWith([relay]);

      expect(screen.getByText("TEE enabled")).toBeInTheDocument();
      expect(screen.getByText("Relay")).toBeInTheDocument();
      expect(screen.getByText("cb62…4c3c")).toBeInTheDocument();
    });

    it("shows Replica mode when every TEE node is a read-only replica", () => {
      renderWith([replica]);

      expect(screen.getByText("Replica")).toBeInTheDocument();
    });

    // core's `memberCount` counts every member row, the TEE node's included;
    // the Members tab next door does not list it, so neither may this count.
    it("leaves TEE nodes out of the member count", () => {
      renderWith([relay, replica]);

      expect(screen.getByText("3")).toBeInTheDocument();
      expect(screen.queryByText("5")).not.toBeInTheDocument();
    });
  });
});
