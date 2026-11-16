import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MembersTab from "./MembersTab";
import type { GroupMember } from "../../api/groupApi";

vi.mock("../IdentityAvatar", () => ({
  IdentityAvatar: () => <span />,
}));

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const CAT = "c".repeat(64);
const OWEN = "d".repeat(64);

const members: GroupMember[] = [
  { identity: ME, alias: "Me", role: "Admin", orgRole: "admin" },
  { identity: BOB, alias: "Bob", role: "Member", orgRole: "member" },
  { identity: CAT, alias: "Cat", role: "Admin", orgRole: "admin" },
  { identity: OWEN, alias: "Owen", role: "Admin", orgRole: "owner" },
];

function renderTab(props: Partial<React.ComponentProps<typeof MembersTab>> = {}) {
  const onSetOrgAdmin = vi.fn().mockResolvedValue(true);
  render(
    <MembersTab
      groupId="group-1"
      members={members}
      selfIdentity={ME}
      canManage
      actionLoading={false}
      onRemoveMember={vi.fn().mockResolvedValue(true)}
      onUpdateRole={vi.fn().mockResolvedValue(true)}
      onSetOrgAdmin={onSetOrgAdmin}
      onSetCapabilities={vi.fn().mockResolvedValue(true)}
      onGetCapabilities={vi.fn().mockResolvedValue({ capabilities: 0 })}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
  return { onSetOrgAdmin };
}

describe("MembersTab: organization admin", () => {
  it("is its own labelled action, apart from the role in Chat", () => {
    const { onSetOrgAdmin } = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Make organization admin" }));
    expect(onSetOrgAdmin).toHaveBeenCalledWith("group-1", BOB, true);
    fireEvent.click(screen.getByRole("button", { name: "Remove organization admin" }));
    expect(onSetOrgAdmin).toHaveBeenCalledWith("group-1", CAT, false);
  });

  it("is never offered on your own row or the owner's", () => {
    renderTab();
    // Bob gets "Make", Cat "Remove"; neither you nor the owner gets one.
    expect(screen.getAllByRole("button", { name: /organization admin/ })).toHaveLength(2);
  });

  it("is not offered to someone who cannot manage the workspace", () => {
    renderTab({ canManage: false });
    expect(screen.queryByRole("button", { name: /organization admin/ })).toBeNull();
  });
});
