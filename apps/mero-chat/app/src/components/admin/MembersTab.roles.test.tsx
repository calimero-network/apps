import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MembersTab from "./MembersTab";
import type { GroupMember } from "../../api/groupApi";

vi.mock("../IdentityAvatar", () => ({
  IdentityAvatar: () => <span />,
}));

vi.mock("../popups/ConfirmPopup", () => ({
  default: ({ toggle, onConfirm }: { toggle: React.ReactNode; onConfirm: () => void }) => (
    <>
      {toggle}
      <button onClick={onConfirm}>confirm-remove</button>
    </>
  ),
}));

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const CAT = "c".repeat(64);

function renderTab(
  members: GroupMember[],
  props: Partial<React.ComponentProps<typeof MembersTab>> = {},
) {
  const onUpdateRole = vi.fn().mockResolvedValue(true);
  const onRemoveMember = vi.fn().mockResolvedValue(true);
  render(
    <MembersTab
      groupId="group-1"
      members={members}
      selfIdentity={ME}
      canManage
      actionLoading={false}
      onRemoveMember={onRemoveMember}
      onUpdateRole={onUpdateRole}
      onSetCapabilities={vi.fn().mockResolvedValue(true)}
      onGetCapabilities={vi.fn().mockResolvedValue({ capabilities: 0 })}
      onRefresh={vi.fn()}
      {...props}
    />,
  );
  return { onUpdateRole, onRemoveMember };
}

const team: GroupMember[] = [
  { identity: ME, alias: "Me", role: "Admin" },
  { identity: BOB, alias: "Bob", role: "Member" },
];

describe("MembersTab workspace roles", () => {
  it("promotes a member to Admin by account", () => {
    const { onUpdateRole } = renderTab(team);
    fireEvent.change(screen.getByLabelText("Role for Bob"), { target: { value: "Admin" } });
    expect(onUpdateRole).toHaveBeenCalledWith("group-1", BOB, "Admin");
  });

  it("demotes another admin while one remains", () => {
    const { onUpdateRole } = renderTab([...team, { identity: CAT, alias: "Cat", role: "Admin" }]);
    fireEvent.change(screen.getByLabelText("Role for Cat"), { target: { value: "Member" } });
    expect(onUpdateRole).toHaveBeenCalledWith("group-1", CAT, "Member");
  });

  it("locks your own role", () => {
    renderTab(team);
    const mine = screen.getByLabelText("Role for Me") as HTMLSelectElement;
    expect(mine.disabled).toBe(true);
    expect(mine.title).toMatch(/another admin/i);
  });

  it("lets an admin remove another admin, never yourself", async () => {
    const { onRemoveMember } = renderTab([
      { identity: ME, alias: "Me", role: "Admin" },
      { identity: CAT, alias: "Cat", role: "Admin" },
    ]);
    // One Remove button: Cat's. Admins used to be unremovable from here.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByText("confirm-remove"));
    await waitFor(() => expect(onRemoveMember).toHaveBeenCalledWith("group-1", CAT));
  });
});

describe("MembersTab for a non-admin", () => {
  it("lists members read-only: badges, no select, no remove, no capabilities", () => {
    renderTab(team, { canManage: false });
    expect(screen.getByText(/only a workspace admin/i)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Capabilities" })).not.toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();
  });
});
