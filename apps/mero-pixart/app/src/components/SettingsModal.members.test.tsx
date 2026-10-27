// Team settings used to promote and demote but could not remove anybody. The
// team's roster is now the shared MembersPanel; what this app adds is the
// document-access cascade after a role change.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NS = "ab".repeat(32);
const ME = "a".repeat(64);
const BEN = "b".repeat(64);

let roster: Array<{ identity: string; role: string; name: string }>;
const listGroupMembers = vi.fn(async () => ({ members: roster.map((r) => ({ ...r })) }));
const updateMemberRole = vi.fn(async (_g: string, identity: string, { role }: { role: string }) => {
  roster = roster.map((r) => (r.identity === identity ? { ...r, role } : r));
});
const removeGroupMembers = vi.fn(async (_g: string, { members }: { members: string[] }) => {
  roster = roster.filter((r) => !members.includes(r.identity));
});
const call = vi.fn().mockResolvedValue([]);
const showToast = vi.fn();

vi.mock("../api/useApi", () => {
  const api = {
    admin: { listGroupMembers, updateMemberRole, removeGroupMembers },
    call,
    getNodeIdentity: vi.fn().mockResolvedValue({ accountId: ME }),
  };
  return { useApi: () => api };
});
vi.mock("../api/teamContexts", () => ({ listTeamContexts: vi.fn().mockResolvedValue(["doc-1", "doc-2"]) }));
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ applicationId: "app-1" }),
}));
vi.mock("../contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));

const SettingsModal = (await import("./SettingsModal")).default;

beforeEach(() => {
  roster = [
    { identity: ME, role: "Admin", name: "Me" },
    { identity: BEN, role: "Member", name: "Ben" },
  ];
  vi.clearAllMocks();
});

async function open() {
  render(<SettingsModal type="team" id={NS} name="Studio" onClose={vi.fn()} />);
  // The panel knows who "you" are once the node identity resolves.
  await waitFor(() => expect(screen.getByLabelText("Role for Ben")).toBeInTheDocument());
}

describe("SettingsModal – team members", () => {
  it("removes a member by account after confirming", async () => {
    await open();
    fireEvent.click(screen.getByLabelText("Remove Ben"));
    expect(removeGroupMembers).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm removing Ben" })).getByText("Remove"));
    await waitFor(() => expect(removeGroupMembers).toHaveBeenCalledWith(NS, { members: [BEN] }));
    await waitFor(() => expect(screen.queryByText("Ben")).not.toBeInTheDocument());
  });

  it("promotes, then grants edit on every document in the team", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Role for Ben"), { target: { value: "Admin" } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith(NS, BEN, { role: "Admin" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("doc-2", "grant_editor", { member: BEN }));
    expect(call).toHaveBeenCalledWith("doc-1", "grant_editor", { member: BEN });
    expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/granted on 2 documents/), "success");
  });

  it("never offers to remove yourself", async () => {
    await open();
    expect(screen.queryByLabelText("Remove Me")).not.toBeInTheDocument();
  });

  it("is read-only for a member", async () => {
    roster = [
      { identity: ME, role: "Member", name: "Me" },
      { identity: BEN, role: "Admin", name: "Ben" },
    ];
    render(<SettingsModal type="team" id={NS} name="Studio" onClose={vi.fn()} />);
    expect(await screen.findByText("Ben")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
  });
});
