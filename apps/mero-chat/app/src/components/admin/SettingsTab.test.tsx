import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsTab from "./SettingsTab";
import type { GroupInfo } from "../../api/groupApi";

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
});
