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
const showToast = vi.fn();

vi.mock("../../api/rpc", () => ({
  listGroupMembers: (...a: unknown[]) => listGroupMembers(...a),
  getMemberCapabilities: (...a: unknown[]) => getMemberCapabilities(...a),
  setMemberCapabilities: (...a: unknown[]) => setMemberCapabilities(...a),
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
  listGroupMembers.mockResolvedValue([
    { identity: ALICE, name: "alice" },
    { identity: BOB, name: "bob" },
  ]);
  getMemberCapabilities.mockResolvedValue(CAN_JOIN_OPEN_SUBGROUPS);
  setMemberCapabilities.mockResolvedValue(undefined);
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

  it("keeps the node's reason AND says who can do it", async () => {
    // A refusal arrives as a bare "forbidden". On its own that tells a user
    // nothing they can act on, so the hint is appended rather than used as a
    // fallback — a fallback is only shown when the node said nothing at all.
    setMemberCapabilities.mockRejectedValue(new Error("forbidden"));
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

describe("a no-op change", () => {
  it("writes nothing when the role is unchanged", async () => {
    open();
    const role = await screen.findByTestId(`role-${BOB}`);
    fireEvent.change(role, { target: { value: "member" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(setMemberCapabilities).not.toHaveBeenCalled();
  });
});
