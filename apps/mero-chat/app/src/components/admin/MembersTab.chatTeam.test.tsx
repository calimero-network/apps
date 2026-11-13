import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MembersTab on the real data source, over an in-memory cluster where the
// workspace has Chat's app team: its role and capability actions write rows
// on that team, never org-wide.
const PKG = "com.calimero.chat";

const h = await vi.hoisted(async () => {
  const { orgCluster } = await import("@calimero-apps/connect/testing");
  return { cluster: orgCluster({ me: "acct-me" }) };
});

vi.mock("../../api/calimero", () => ({
  after: () => {},
  getClient: () => h.cluster.client,
  getAccountId: () => "acct-me",
  chatSource: () => ({ package: "com.calimero.chat" }),
  passkey: () => ({ create: vi.fn(), get: vi.fn() }),
}));

vi.mock("../IdentityAvatar", () => ({
  IdentityAvatar: () => <span />,
}));

vi.mock("../popups/ConfirmPopup", () => ({
  default: ({ toggle }: { toggle: React.ReactNode }) => <>{toggle}</>,
}));

import MembersTab from "./MembersTab";
import { GroupApiDataSource } from "../../api/dataSource/groupApiDataSource";
import { invalidate } from "../../api/platform";

const CREATE_APP = 1 << 0;
const CREATE_CHILD_TEAM = 1 << 11;

const api = new GroupApiDataSource();

async function renderWorkspace() {
  const org = h.cluster.addOrg({
    mode: "standalone",
    app: PKG,
    members: { "acct-bob": "member" },
    appTeamRows: ["acct-me", "acct-bob"],
  });
  const team = h.cluster.teamOf(org, PKG)!;
  h.cluster.org(org).teams[team]!.members["acct-me"] = true;
  invalidate();
  const members = (await api.listMembers(org)).data!.members;
  render(
    <MembersTab
      groupId={org}
      members={members.map((m) => (m.identity === "acct-bob" ? { ...m, alias: "Bob" } : m))}
      selfIdentity="acct-me"
      canManage
      actionLoading={false}
      onRemoveMember={vi.fn().mockResolvedValue(true)}
      onUpdateRole={async (g, id, role) => !(await api.updateMemberRole(g, id, role)).error}
      onSetCapabilities={async (g, id, capabilities) => !(await api.setMemberCapabilities(g, id, { capabilities })).error}
      onGetCapabilities={async (g, id) => (await api.getMemberCapabilities(g, id)).data ?? null}
      onRefresh={vi.fn()}
    />,
  );
  return { org, team };
}

beforeEach(() => {
  h.cluster.calls.length = 0;
  invalidate();
});

describe("MembersTab on Chat's app team", () => {
  it("makes a member a Chat admin: a lead of Chat's team", async () => {
    const { org, team } = await renderWorkspace();
    fireEvent.change(screen.getByLabelText("Role for Bob"), { target: { value: "Admin" } });
    await waitFor(() => expect(h.cluster.callsOf("setTeamMember")).toHaveLength(1));
    expect(h.cluster.callsOf("setTeamMember")[0]).toEqual([
      org,
      team,
      "acct-bob",
      expect.anything(),
      expect.objectContaining({ lead: true, role: "lead" }),
    ]);
    expect(h.cluster.callsOf("setMember")).toEqual([]);
    expect(h.cluster.callsOf("setCapabilities")).toEqual([]);
  });

  it("saves Create channels on the person's Chat-team row, keeping them a member", async () => {
    const { org, team } = await renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: /capabilities/i }));
    const toggle = await screen.findByRole("checkbox");
    if (!(toggle as HTMLInputElement).checked) fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(h.cluster.callsOf("setTeamMember")).toHaveLength(1));
    const [args] = h.cluster.callsOf("setTeamMember");
    expect(args!.slice(0, 3)).toEqual([org, team, "acct-bob"]);
    const row = args![4] as { lead: boolean; role: string; capabilities: number };
    expect(row).toMatchObject({ lead: false, role: "member" });
    expect(row.capabilities & (CREATE_APP | CREATE_CHILD_TEAM)).toBe(CREATE_APP | CREATE_CHILD_TEAM);
    expect(h.cluster.callsOf("setMember")).toEqual([]);
    expect(h.cluster.callsOf("setCapabilities")).toEqual([]);
  });
});
