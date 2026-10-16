import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembersPanel } from "./MembersPanel";
import type { MembersAdmin } from "./useWorkspaceMembers";

const ME = "a".repeat(64);
const BOB = "b".repeat(64);
const CAT = "c".repeat(64);
const TEE = "d".repeat(64);

let seq = 0;
let roster: Array<{ identity: string; role: string; name?: string }>;
let admin: MembersAdmin & {
  listGroupMembers: ReturnType<typeof vi.fn>;
  removeGroupMembers: ReturnType<typeof vi.fn>;
  updateMemberRole: ReturnType<typeof vi.fn>;
};
// Every test on its own group, so the shared name directory's cache from one
// test never answers for another.
let group: string;

beforeEach(() => {
  group = `group-${++seq}`;
  roster = [
    { identity: ME, role: "Admin", name: "Me" },
    { identity: BOB, role: "Member", name: "Bob" },
    { identity: CAT, role: "Member", name: "Cat" },
  ];
  admin = {
    listGroupMembers: vi.fn(async () => ({ members: roster.map((r) => ({ ...r })) })),
    removeGroupMembers: vi.fn(async (_g: string, { members }: { members: string[] }) => {
      roster = roster.filter((r) => !members.includes(r.identity));
    }),
    updateMemberRole: vi.fn(async (_g: string, identity: string, { role }: { role: string }) => {
      roster = roster.map((r) => (r.identity === identity ? { ...r, role } : r));
    }),
  };
});

function rowOf(account: string): HTMLElement {
  const row = screen
    .getAllByTestId("member-row")
    .find((r) => r.getAttribute("data-account") === account);
  if (!row) throw new Error(`no row for ${account}`);
  return row;
}

async function open(props: Partial<React.ComponentProps<typeof MembersPanel>> = {}) {
  render(<MembersPanel admin={admin} groupId={group} selfAccount={ME} {...props} />);
  await screen.findByText("Bob");
}

describe("MembersPanel as an admin", () => {
  it("lists people with their names and marks your own row", async () => {
    await open();
    expect(screen.getByText("Members (3)")).toBeTruthy();
    expect(within(rowOf(ME)).getByText("you")).toBeTruthy();
    expect(within(rowOf(BOB)).queryByText("you")).toBeNull();
  });

  it("promotes through updateMemberRole with the member's ACCOUNT, then re-reads", async () => {
    await open();
    const before = admin.listGroupMembers.mock.calls.length;
    fireEvent.change(screen.getByLabelText("Role for Bob"), { target: { value: "Admin" } });
    await waitFor(() => expect(admin.updateMemberRole).toHaveBeenCalledWith(group, BOB, { role: "Admin" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Role for Bob") as HTMLSelectElement).value).toBe("Admin"),
    );
    expect(admin.listGroupMembers.mock.calls.length).toBeGreaterThan(before);
  });

  it("removes only after confirming, by ACCOUNT", async () => {
    const onRemoved = vi.fn();
    await open({ onRemoved });
    fireEvent.click(screen.getByLabelText("Remove Bob"));
    expect(admin.removeGroupMembers).not.toHaveBeenCalled();
    expect(screen.getByText("Remove Bob from this workspace?")).toBeTruthy();

    fireEvent.click(within(screen.getByRole("group", { name: "Confirm removing Bob" })).getByText("Remove"));
    await waitFor(() => expect(admin.removeGroupMembers).toHaveBeenCalledWith(group, { members: [BOB] }));
    await waitFor(() => expect(screen.queryByText("Bob")).toBeNull());
    expect(onRemoved).toHaveBeenCalledWith(BOB);
  });

  it("cancelling a removal removes nobody", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("Remove Bob"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(admin.removeGroupMembers).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Remove Bob")).toBeTruthy();
  });

  it("shows the node's refusal instead of pretending it worked", async () => {
    admin.removeGroupMembers.mockRejectedValueOnce(new Error("forbidden"));
    await open();
    fireEvent.click(screen.getByLabelText("Remove Bob"));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("group", { name: "Confirm removing Bob" })).getByText("Remove"));
    });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't remove Bob: forbidden/);
    expect(screen.getByText("Bob")).toBeTruthy();
  });

  it("never offers to remove yourself, or to demote you as the last admin", async () => {
    await open();
    expect(screen.queryByLabelText("Remove Me")).toBeNull();
    const mine = screen.getByLabelText("Role for Me") as HTMLSelectElement;
    expect(mine.disabled).toBe(true);
    expect(mine.title).toMatch(/only admin/i);
  });

  it("lets you step down only after confirming, while another admin remains", async () => {
    roster[1]!.role = "Admin";
    await open();
    fireEvent.change(screen.getByLabelText("Role for Me"), { target: { value: "Member" } });
    expect(admin.updateMemberRole).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Make me a member"));
    await waitFor(() => expect(admin.updateMemberRole).toHaveBeenCalledWith(group, ME, { role: "Member" }));
  });

  it("does not offer removing the last admin even to a manager", async () => {
    roster = [
      { identity: ME, role: "Member", name: "Me" },
      { identity: BOB, role: "Admin", name: "Bob" },
    ];
    await open({ canManage: true });
    expect(screen.queryByLabelText("Remove Bob")).toBeNull();
  });

  it("keeps a TEE node out of the list and says the workspace has one", async () => {
    roster.push({ identity: TEE, role: "RelayTee" });
    await open();
    expect(screen.getByText("Members (3)")).toBeTruthy();
    expect(screen.getByTestId("members-tee").textContent).toMatch(/TEE enabled · Relay/);
  });

  it("reports a failed follow-up without undoing the role change", async () => {
    await open({ onRoleChanged: () => Promise.reject(new Error("2 documents not updated")) });
    fireEvent.change(screen.getByLabelText("Role for Bob"), { target: { value: "Admin" } });
    expect((await screen.findByRole("status")).textContent).toMatch(/Bob is now an admin, but: 2 documents/);
  });

  it("calls the invite callback", async () => {
    const onInvite = vi.fn();
    await open({ onInvite });
    fireEvent.click(screen.getByText("Invite"));
    expect(onInvite).toHaveBeenCalled();
  });
});

describe("MembersPanel as a member", () => {
  beforeEach(() => {
    roster[0]!.role = "Member";
    roster[1]!.role = "Admin";
  });

  it("shows the list read-only: roles as badges, no remove, invite disabled", async () => {
    await open({ onInvite: vi.fn() });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Remove")).toBeNull();
    expect(within(rowOf(BOB)).getByTestId("member-role").textContent).toBe("Admin");
    expect((screen.getByText("Invite") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("MembersPanel loading", () => {
  it("offers a retry when the roster cannot be read", async () => {
    admin.listGroupMembers = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ members: roster });
    render(<MembersPanel admin={admin} groupId={group} selfAccount={ME} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/offline/);
    fireEvent.click(within(alert).getByText("Retry"));
    expect(await screen.findByText("Bob")).toBeTruthy();
  });
});
