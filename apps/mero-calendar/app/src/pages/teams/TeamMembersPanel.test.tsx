/**
 * Promoting a team member.
 *
 * ⚠️ The behaviour worth pinning is not "a select changed" — it is that the
 * mask written back is built from the member's CURRENT capabilities, re-read at
 * the moment of the change. Core keeps adding capability bits; a panel that
 * writes a mask from scratch silently revokes every bit it has never heard of,
 * and nothing anywhere reports it.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listGroupMembers = vi.fn();
const getMemberCapabilities = vi.fn();
const setMemberCapabilities = vi.fn();
const updateMemberRole = vi.fn();
const removeGroupMembers = vi.fn();
const showToast = vi.fn();

// The panel reaches the admin API through `useMero().admin` — the
// session-aware client — and `api/admin` is a thin shim over it, so the mocks
// sit on the client itself. The row shapes are what mero-js returns.
const admin = {
  listGroupMembers: (groupId: string) =>
    Promise.resolve(listGroupMembers(groupId)).then((rows) => ({ members: rows })),
  getMemberCapabilities: (groupId: string, identity: string) =>
    Promise.resolve(getMemberCapabilities(groupId, identity)).then(
      (capabilities) => ({ capabilities }),
    ),
  setMemberCapabilities: (
    groupId: string,
    identity: string,
    req: { capabilities: number },
  ) => setMemberCapabilities(groupId, identity, req.capabilities),
  updateMemberRole: (groupId: string, identity: string, req: { role: string }) =>
    updateMemberRole(groupId, identity, req.role),
  removeGroupMembers: (groupId: string, req: { members: string[] }) =>
    removeGroupMembers(groupId, req.members),
  getGroupInfo: vi.fn(async () => ({ defaultCapabilities: 0 })),
};
vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin, isDelegated: false }),
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast }),
}));

let me = "";
vi.mock("../../api/identity", () => ({ accountId: () => me }));

import TeamMembersPanel from "./TeamMembersPanel";
import {
  ADMIN_CAPABILITIES,
  CAN_JOIN_OPEN_SUBGROUPS,
} from "../../api/roles";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
  me = ALICE;
  // ALICE, the signed-in member, is the team's admin: only an admin is
  // offered controls at all.
  listGroupMembers.mockResolvedValue([
    { identity: ALICE, name: "alice", role: "Admin" },
    { identity: BOB, name: "bob", role: "Member" },
  ]);
  getMemberCapabilities.mockResolvedValue(CAN_JOIN_OPEN_SUBGROUPS);
  setMemberCapabilities.mockResolvedValue(undefined);
  updateMemberRole.mockResolvedValue(undefined);
  removeGroupMembers.mockResolvedValue(undefined);
});

function open() {
  return render(<TeamMembersPanel teamId="team-1" onClose={() => {}} />);
}

describe("the member list", () => {
  it("lists the team and marks which row is you", async () => {
    open();
    await screen.findByTestId(`member-${ALICE}`);
    expect(screen.getByTestId(`member-${BOB}`)).toBeTruthy();
    expect(screen.getAllByText("you")).toHaveLength(1);
  });

  it("reads everyone as a Member when nobody holds the admin bits", async () => {
    open();
    const role = (await screen.findByTestId(`role-${BOB}`)) as HTMLSelectElement;
    expect(role.value).toBe("member");
  });

  it("reads the admin set as Admin", async () => {
    getMemberCapabilities.mockResolvedValue(ADMIN_CAPABILITIES);
    open();
    const role = (await screen.findByTestId(`role-${BOB}`)) as HTMLSelectElement;
    expect(role.value).toBe("admin");
  });

  it("treats unreadable capabilities as none, never as admin", async () => {
    getMemberCapabilities.mockRejectedValue(new Error("403"));
    open();
    const role = (await screen.findByTestId(`role-${BOB}`)) as HTMLSelectElement;
    expect(role.value).toBe("member");
  });
});

describe("promoting", () => {
  it("writes the admin bits WITHOUT dropping the ones it does not manage", async () => {
    const future = 1 << 20;
    getMemberCapabilities.mockResolvedValue(CAN_JOIN_OPEN_SUBGROUPS | future);
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "admin" } });

    await waitFor(() => expect(setMemberCapabilities).toHaveBeenCalled());
    expect(setMemberCapabilities).toHaveBeenCalledWith(
      "team-1",
      BOB,
      ADMIN_CAPABILITIES | CAN_JOIN_OPEN_SUBGROUPS | future,
    );
  });

  it("addresses the member by ACCOUNT, as the row is keyed", async () => {
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "admin" } });
    await waitFor(() => expect(setMemberCapabilities).toHaveBeenCalled());
    expect(setMemberCapabilities.mock.calls[0][1]).toBe(BOB);
  });

  it("re-reads the current mask before writing", async () => {
    // Governance state another admin may have changed since the list was drawn.
    open();
    await screen.findByTestId(`role-${BOB}`);
    getMemberCapabilities.mockClear();
    fireEvent.change(screen.getByTestId(`role-${BOB}`), {
      target: { value: "admin" },
    });
    await waitFor(() => expect(setMemberCapabilities).toHaveBeenCalled());
    expect(getMemberCapabilities).toHaveBeenCalledWith("team-1", BOB);
  });

  it("moves the CORE role, not only the mask", async () => {
    // Writing only the mask made an "Admin" here whom the node still treated
    // as a member.
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "admin" } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith("team-1", BOB, "Admin"));
    expect(updateMemberRole.mock.invocationCallOrder[0]).toBeLessThan(
      setMemberCapabilities.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it("touches no capability when the node refuses the role", async () => {
    updateMemberRole.mockRejectedValue(new Error("forbidden"));
    open();
    fireEvent.change(await screen.findByTestId(`role-${BOB}`), { target: { value: "admin" } });
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(setMemberCapabilities).not.toHaveBeenCalled();
  });

  it("keeps the node's reason AND says who can do it", async () => {
    // A refusal arrives as a bare "forbidden". On its own that tells a user
    // nothing they can act on, so the hint is appended rather than used as a
    // fallback — a fallback is only shown when the node said nothing at all.
    updateMemberRole.mockRejectedValue(new Error("forbidden"));
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "admin" } });
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    const msg = String(showToast.mock.calls.at(-1)?.[0]);
    expect(msg).toMatch(/forbidden/i);
    expect(msg).toMatch(/team admin/i);
  });
});

describe("demoting", () => {
  it("clears the admin bits but keeps open-subgroup reach", async () => {
    getMemberCapabilities.mockResolvedValue(
      ADMIN_CAPABILITIES | CAN_JOIN_OPEN_SUBGROUPS,
    );
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "member" } });
    await waitFor(() => expect(setMemberCapabilities).toHaveBeenCalled());
    expect(setMemberCapabilities).toHaveBeenCalledWith(
      "team-1",
      BOB,
      CAN_JOIN_OPEN_SUBGROUPS,
    );
  });
});

describe("demoting a core admin", () => {
  it("moves the core role back to Member and clears the admin bits", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice", role: "Admin" },
      { identity: BOB, name: "bob", role: "Admin" },
    ]);
    getMemberCapabilities.mockResolvedValue(ADMIN_CAPABILITIES | CAN_JOIN_OPEN_SUBGROUPS);
    open();
    fireEvent.change(await screen.findByTestId(`role-${BOB}`), { target: { value: "member" } });
    await waitFor(() => expect(updateMemberRole).toHaveBeenCalledWith("team-1", BOB, "Member"));
    await waitFor(() =>
      expect(setMemberCapabilities).toHaveBeenCalledWith("team-1", BOB, CAN_JOIN_OPEN_SUBGROUPS),
    );
  });
});

describe("removing", () => {
  it("removes a member by ACCOUNT after confirming", async () => {
    open();
    fireEvent.click(await screen.findByLabelText("Remove bob"));
    expect(removeGroupMembers).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Remove"));
    await waitFor(() => expect(removeGroupMembers).toHaveBeenCalledWith("team-1", [BOB]));
  });

  it("never offers to remove yourself or the only admin", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice", role: "Member" },
      { identity: BOB, name: "bob", role: "Admin" },
    ]);
    // ALICE manages members by capability, not by role.
    getMemberCapabilities.mockImplementation(async (_g: string, id: string) =>
      id === ALICE ? ADMIN_CAPABILITIES : CAN_JOIN_OPEN_SUBGROUPS,
    );
    open();
    await screen.findByTestId(`member-${BOB}`);
    // Two admins now (ALICE by mask, BOB by role), so BOB may go…
    expect(screen.getByLabelText("Remove bob")).toBeTruthy();
    // …but never ALICE herself.
    expect(screen.queryByLabelText("Remove alice")).toBeNull();
  });

  it("protects the only admin", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice", role: "Member" },
      { identity: BOB, name: "bob", role: "Admin" },
    ]);
    getMemberCapabilities.mockImplementation(async (_g: string, id: string) =>
      id === ALICE ? 8 /* MANAGE_MEMBERS only */ : CAN_JOIN_OPEN_SUBGROUPS,
    );
    open();
    await screen.findByTestId(`member-${BOB}`);
    expect(screen.queryByLabelText("Remove bob")).toBeNull();
  });
});

describe("a member who cannot manage", () => {
  it("sees the list read-only", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice", role: "Member" },
      { identity: BOB, name: "bob", role: "Admin" },
    ]);
    open();
    await screen.findByTestId(`member-${BOB}`);
    expect(screen.queryByTestId(`role-${BOB}`)).toBeNull();
    expect(screen.getByTestId(`role-badge-${BOB}`).textContent).toBe("Admin");
    expect(screen.queryByText("Remove")).toBeNull();
  });
});

describe("a no-op change", () => {
  it("writes nothing when the role is unchanged", async () => {
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "member" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(setMemberCapabilities).not.toHaveBeenCalled();
  });
});

describe("TEE nodes", () => {
  // A TEE fleet node is admitted to the team as a member row (role
  // `ReadOnlyTee` / `RelayTee`). It used to show up here as a nameless person
  // with an editable role; it is infrastructure, so it is shown as "TEE
  // enabled" instead.
  const REPLICA = "c".repeat(64);
  const RELAY = "d".repeat(64);

  it("keeps TEE nodes out of the member list", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice" },
      { identity: BOB, name: "bob" },
      { identity: REPLICA, role: "ReadOnlyTee" },
      { identity: RELAY, role: "RelayTee" },
    ]);
    open();
    await screen.findByTestId(`member-${BOB}`);
    expect(screen.queryByTestId(`member-${REPLICA}`)).toBeNull();
    expect(screen.queryByTestId(`member-${RELAY}`)).toBeNull();
    expect(getMemberCapabilities).not.toHaveBeenCalledWith("team-1", REPLICA);
  });

  it("shows TEE enabled, in Relay mode when a relay TEE is admitted", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice" },
      { identity: REPLICA, role: "ReadOnlyTee" },
      { identity: RELAY, role: "RelayTee" },
    ]);
    open();
    const badge = await screen.findByTestId("tee-enabled");
    expect(badge.textContent).toMatch(/TEE enabled/);
    expect(badge.textContent).toMatch(/Relay/);
    expect(badge.getAttribute("title")).toMatch(/hardware-attested/i);
  });

  it("shows Replica mode when every TEE node is a read-only replica", async () => {
    listGroupMembers.mockResolvedValue([
      { identity: ALICE, name: "alice" },
      { identity: REPLICA, role: "ReadOnlyTee" },
    ]);
    open();
    const badge = await screen.findByTestId("tee-enabled");
    expect(badge.textContent).toMatch(/Replica/);
  });

  it("shows nothing when the team has no TEE node", async () => {
    open();
    await screen.findByTestId(`member-${BOB}`);
    expect(screen.queryByTestId("tee-enabled")).toBeNull();
  });
});
