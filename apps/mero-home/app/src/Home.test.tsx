import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrgInvite } from "@calimero-network/mero-js";

import { Home } from "./Home";
import { BETA, BLOCKS, CHAT, CRM, ORG, fakeOrg, passkey, type FakeOrgOptions } from "./test/fakeOrg";

afterEach(cleanup);

const noop = () => {};

function open(opts: FakeOrgOptions = {}) {
  const fake = fakeOrg(opts);
  render(
    <Home
      client={fake.asClient}
      account={fake.me}
      passkey={passkey}
      after={noop}
      initialOrg={ORG}
      storage={undefined}
    />,
  );
  return fake;
}

const tabs = async () => {
  await screen.findByTestId("tab-apps");
  return screen.getAllByRole("tab").map((t) => t.textContent);
};

describe("Home: org picker and screens per role", () => {
  it("opens the org from ?org= and shows its mode", async () => {
    open();
    expect(await screen.findByTestId("org-mode")).toHaveProperty("textContent", "Owner · Shared: each app lists who is in it");
    expect((screen.getByTestId("org-picker") as HTMLSelectElement).value).toBe(ORG);
  });

  it("an admin gets every screen; a member Apps and People; a guest Apps only", async () => {
    open({ as: "admin" });
    expect(await tabs()).toEqual(["Your apps", "People", "Invitations", "Admin", "Organization"]);
    cleanup();
    open({ as: "member" });
    expect(await tabs()).toEqual(["Your apps", "People"]);
    cleanup();
    open({ as: "guest" });
    expect(await tabs()).toEqual(["Your apps"]);
  });
});

describe("Your apps", () => {
  it("lists the apps the account is in with an open link; an admin also sees the rest", async () => {
    open({ as: "admin" });
    const chat = await screen.findByTestId(`app-${CHAT}`);
    expect(within(chat).queryByText("Open")).toBeNull(); // the admin is not in Chat
    expect(screen.getByTestId("other-apps").textContent).toContain("Chat");
    expect(screen.getByTestId(`app-${CRM}`).textContent).toContain("Everyone in the organization");
  });

  it("a member's open link carries the org and the app team", async () => {
    open({ as: "member" });
    const link = (await screen.findByTestId(`open-${CHAT}`)) as HTMLAnchorElement;
    const url = new URL(link.href);
    expect(url.searchParams.get("org")).toBe(ORG);
    expect(url.searchParams.get("team")).toBe("t-chat");
    expect(screen.queryByTestId(`open-${BLOCKS}`)).toBeNull();
  });

  it("on a node without app teams, lists the legacy apps the node lets the account reach", async () => {
    open({ as: "guest", mode: "legacy", noRoute: true });
    expect(await screen.findByTestId(`open-${CHAT}`)).toBeTruthy();
  });

  it("says 'No apps yet' to someone in no app", async () => {
    const fake = fakeOrg({ as: "member" });
    fake.client.listAppTeams.mockResolvedValue({ mode: "shared", appTeams: [] });
    fake.client.listApps.mockResolvedValue([]);
    render(<Home client={fake.asClient} account={fake.me} passkey={passkey} after={noop} initialOrg={ORG} storage={undefined} />);
    expect((await screen.findByTestId("no-apps")).textContent).toContain("ask an admin");
  });
});

describe("People", () => {
  it("shows the matrix and removes someone from the org, and so from every app, after a confirm", async () => {
    const fake = open();
    fireEvent.click(await screen.findByTestId("tab-people"));
    const bob = await screen.findByTestId("person-acct-bob");
    // An admin's matrix: Bob's place in each closed app, which the admin can change.
    await waitFor(() => expect((within(bob).getByTestId(`seat-${CHAT}-acct-bob`) as HTMLSelectElement).value).toBe("member"));
    fireEvent.click(within(bob).getByTestId("remove-acct-bob"));
    const confirm = screen.getByTestId("remove-confirm");
    expect(confirm.textContent).toContain("from every app in it");
    expect(confirm.textContent).toContain("Chat, Mero Crm");
    expect(fake.client.removeMember).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("remove-confirm-yes"));
    await waitFor(() => expect(fake.client.removeMember).toHaveBeenCalledWith(ORG, "acct-bob", expect.anything()));
    expect(await screen.findByTestId("people-notice")).toHaveProperty(
      "textContent",
      "Bob was removed from Acme and from every app in it.",
    );
  });

  it("offers no removal to a member, and never on your own row", async () => {
    open({ as: "member" });
    fireEvent.click(await screen.findByTestId("tab-people"));
    await screen.findByTestId("person-acct-bob");
    expect(screen.queryByText("Remove from organization…")).toBeNull();
    cleanup();
    open();
    fireEvent.click(await screen.findByTestId("tab-people"));
    expect(within(await screen.findByTestId("person-acct-ana")).queryByTestId("remove-acct-ana")).toBeNull();
  });

  it("opens on the org as it is now: someone who joined since the last read is listed", async () => {
    const fake = open();
    await screen.findByTestId("org-mode");
    const before = await fake.client.getOrg.mock.results[0]!.value;
    fake.client.getOrg.mockResolvedValue({
      ...before,
      members: { ...before.members, "acct-eve": "member" },
      memberMetadata: { ...before.memberMetadata, "acct-eve": { name: "Eve" } },
    });
    fireEvent.click(screen.getByTestId("tab-people"));
    expect((await screen.findByTestId("person-acct-eve")).textContent).toContain("Eve");
  });

  it("a member sees the people core lets them see (decision 2)", async () => {
    open({ as: "member" });
    fireEvent.click(await screen.findByTestId("tab-people"));
    await screen.findByTestId("person-acct-bob");
    expect(screen.queryByTestId("person-acct-cat")).toBeNull();
  });
});

describe("Invitations", () => {
  const pending: OrgInvite[] = [
    {
      inviteKey: "inv-1",
      role: "member",
      teams: ["t-chat", "t-blocks"],
      usesLeft: 2,
      expiresAt: Math.floor(Date.now() / 1000) + 3 * 86_400,
      expired: false,
      createdBy: "acct-ana",
      createdAt: 1,
      allApps: false,
    },
  ];

  it("invites to the apps checked, naming their teams, and shows the link", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-invitations"));
    fireEvent.click(await screen.findByTestId(`invite-app-${CHAT}`));
    fireEvent.click(screen.getByTestId(`invite-app-${BLOCKS}`));
    fireEvent.change(screen.getByTestId("invite-role"), { target: { value: "guest" } });
    fireEvent.click(screen.getByTestId("invite-create"));
    await waitFor(() =>
      expect(fake.client.invite).toHaveBeenCalledWith(ORG, "guest", expect.anything(), ["t-chat", "t-blocks"], {
        uses: 1,
        ttlSecs: 7 * 86_400,
      }),
    );
    expect((await screen.findByTestId("invite-link")).textContent).toContain("invite=tok-new");
  });

  it("All apps checks every app the caller may name, and clears them again", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-invitations"));
    const all = (await screen.findByTestId("invite-all-apps")) as HTMLInputElement;
    const box = (pkg: string) => screen.getByTestId(`invite-app-${pkg}`) as HTMLInputElement;
    fireEvent.click(box(CHAT));
    expect(all.checked).toBe(false);
    expect(all.indeterminate).toBe(true);
    fireEvent.click(all);
    expect([box(CHAT).checked, box(BLOCKS).checked, all.checked]).toEqual([true, true, true]);
    // Core has no standing invite to apps added later: said, not offered.
    expect(screen.getByTestId("invite-all-later").textContent).toContain("added to the organization later are not part");
    fireEvent.click(screen.getByTestId("invite-create"));
    await waitFor(() => expect(fake.client.invite).toHaveBeenCalledWith(ORG, "member", expect.anything(), ["t-blocks", "t-chat"], expect.anything()));
    fireEvent.click(all);
    expect([box(CHAT).checked, box(BLOCKS).checked]).toEqual([false, false]);
  });

  it("offers no All apps for one app", async () => {
    open({ as: "lead" });
    fireEvent.click(await screen.findByTestId("tab-invitations"));
    await screen.findByTestId(`invite-app-${CHAT}`);
    expect(screen.queryByTestId("invite-all-apps")).toBeNull();
  });

  it("lists pending invites by app and revokes one", async () => {
    const fake = open({ as: "admin", invites: pending });
    fireEvent.click(await screen.findByTestId("tab-invitations"));
    const row = await screen.findByTestId("pending-inv-1");
    expect(row.textContent).toContain("Chat, Blocks");
    expect(row.textContent).toContain("2 uses left");
    expect(row.textContent).toContain("yours");
    fireEvent.click(within(row).getByTestId("revoke-inv-1"));
    await waitFor(() => expect(fake.client.revokeInvite).toHaveBeenCalledWith(ORG, "inv-1", expect.anything()));
    expect(await screen.findByTestId("no-pending")).toBeTruthy();
  });

  it("a lead may invite only to the app they lead, and not as admin", async () => {
    open({ as: "lead" });
    fireEvent.click(await screen.findByTestId("tab-invitations"));
    expect(await screen.findByTestId(`invite-app-${CHAT}`)).toBeTruthy();
    expect(screen.queryByTestId(`invite-app-${BLOCKS}`)).toBeNull();
    const roles = Array.from((screen.getByTestId("invite-role") as HTMLSelectElement).options).map((o) => o.value);
    expect(roles).toEqual(["member", "guest"]);
  });
});

describe("Organization", () => {
  it("shows the org's display name and logo in the header", async () => {
    open({ as: "member", metadata: { displayName: "Acme Labs", logo: "data:image/png;base64,iVBORw0KGgo=" } });
    expect((await screen.findByTestId("org-profile")).textContent).toBe("Acme Labs");
  });

  it("after the owner deletes the org, Home goes back to the picker, without it", async () => {
    const fake = open({ as: "owner" });
    fireEvent.click(await screen.findByTestId("tab-settings"));
    fireEvent.click(await screen.findByTestId("delete-org"));
    fireEvent.change(screen.getByTestId("delete-org-typed"), { target: { value: "Acme" } });
    fake.client.me.mockResolvedValue({ accountId: fake.me, orgs: [] });
    fireEvent.click(screen.getByTestId("delete-org-yes"));
    expect(await screen.findByTestId("no-orgs")).toBeTruthy();
    expect(screen.queryByTestId("tab-settings")).toBeNull();
  });
});

describe("Admin", () => {
  it("turns 'members may invite' on for one app", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    const box = (await screen.findByTestId(`members-invite-${CHAT}`)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(fake.client.setTeamDefaultCapabilities).toHaveBeenCalledWith(ORG, "t-chat", 2, expect.anything()));
  });

  it("gives a legacy app its own access list, keeping everyone: open by default", async () => {
    const fake = open({ as: "admin", mode: "standalone" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.click(await screen.findByTestId(`scope-${CRM}`));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: CRM, name: "Mero Crm" }],
        shared: false,
      }),
    );
  });

  it("in an org that keeps apps apart, a legacy app's own list matches it (closed)", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.click(await screen.findByTestId(`scope-${CRM}`));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: CRM, name: "Mero Crm" }],
        shared: true,
      }),
    );
  });

  it("adds an app for everyone by default, however many apps the org holds", async () => {
    const fake = open({ as: "admin", mode: "standalone" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.change(await screen.findByTestId("add-app-package"), { target: { value: "com.calimero.mero-sheets" } });
    expect(screen.getByTestId("add-app-who").textContent).toBe("Everyone in the organization gets it.");
    expect(screen.queryByTestId("add-app-closes")).toBeNull();
    fireEvent.click(screen.getByTestId("add-app"));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: "com.calimero.mero-sheets", name: "Mero Sheets", instances: [] }],
        shared: false,
      }),
    );
  });

  it("in an org that keeps apps apart, adds an app as a closed team with no instances, and links to open it", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    const select = (await screen.findByTestId("add-app-package")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", CRM, "com.calimero.mero-sheets"]);
    fireEvent.change(select, { target: { value: "com.calimero.mero-sheets" } });
    fireEvent.click(screen.getByTestId("add-app"));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: "com.calimero.mero-sheets", name: "Mero Sheets", instances: [] }],
        shared: true,
      }),
    );
    expect((await screen.findByTestId("app-added")).textContent).toContain("Open Mero Sheets");
  });

  it("warns that adding an app to an org that keeps apps apart closes an app opened on its own", async () => {
    open({ as: "admin", chatOpen: true });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.change(await screen.findByTestId("add-app-package"), { target: { value: CRM } });
    expect(screen.getByTestId("add-app-closes").textContent).toContain("Chat will list its own people again");
  });
});

describe("Moving apps and merging organizations", () => {
  const beta = { orgId: BETA, name: "Beta", role: "owner" };

  it("moves one app to another organization the admin holds, with its people", async () => {
    const fake = open({ as: "owner", otherOrgs: [beta] });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.click(await screen.findByTestId("move-crm-1"));
    const target = screen.getByTestId("move-target-crm-1") as HTMLSelectElement;
    expect(Array.from(target.options).map((o) => o.value)).toEqual(["", BETA]);
    expect((screen.getByTestId("move-go-crm-1") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(target, { target: { value: BETA } });
    fireEvent.click(screen.getByTestId("move-go-crm-1"));
    await waitFor(() =>
      expect(fake.client.postConfirmed).toHaveBeenCalledWith(
        "apps/crm-1/move",
        { toOrg: BETA, bringMembers: true },
        expect.anything(),
      ),
    );
    expect((await screen.findByTestId("app-moved")).textContent).toContain("pipeline moved to Beta");
  });

  it("offers neither moving nor merging on a node without the route", async () => {
    const fake = open({ as: "owner", otherOrgs: [beta], noMove: true });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    await screen.findByTestId(`admin-app-${CRM}`);
    await waitFor(() => expect(fake.client.post).toHaveBeenCalled());
    expect(screen.queryByTestId("move-crm-1")).toBeNull();
    expect(screen.queryByTestId("merge-orgs")).toBeNull();
  });

  it("offers nothing to move to when the admin holds no other organization", async () => {
    open({ as: "owner" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    expect(await screen.findByTestId("merge-no-sources")).toBeTruthy();
    expect(screen.queryByTestId("move-crm-1")).toBeNull();
  });

  it("merges: shows the source, moves each app with a passkey, reports each, and keeps a source not yet empty", async () => {
    const fake = open({ as: "owner", otherOrgs: [beta, { orgId: "gamma", name: "Gamma", role: "member" }] });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    const source = (await screen.findByTestId("merge-source")) as HTMLSelectElement;
    expect(Array.from(source.options).map((o) => o.value)).toEqual(["", BETA]);
    fireEvent.change(source, { target: { value: BETA } });
    expect((await screen.findByTestId("merge-apps")).textContent).toContain("Archive");
    expect(screen.getByTestId("merge-people").textContent).toContain("Dan");
    fireEvent.click(screen.getByTestId("merge-move"));
    expect((await screen.findByTestId("merge-result-beta-notes")).textContent).toContain("moved, 1 joined Acme");
    expect((await screen.findByTestId("merge-result-beta-big")).textContent).toContain("not moved");
    expect(fake.client.postConfirmed).toHaveBeenCalledTimes(2);
    for (const app of ["beta-notes", "beta-big"]) {
      expect(fake.client.postConfirmed).toHaveBeenCalledWith(
        `apps/${app}/move`,
        { toOrg: ORG, bringMembers: true },
        expect.anything(),
      );
    }
    expect((await screen.findByTestId("merge-keep")).textContent).toContain("still holds 1 app");
    expect(screen.queryByTestId("merge-delete")).toBeNull();
  });

  it("deletes the emptied source only after its name is typed", async () => {
    const fake = open({ as: "owner", otherOrgs: [beta] });
    const moved = new Set<string>();
    fake.client.postConfirmed.mockImplementation(async (path: string, body: { toOrg: string }) => {
      const app = path.split("/")[1]!;
      moved.add(app);
      return { appId: app, from: BETA, org: body.toOrg, access: { kind: "org" }, created: false, added: [], revokedInvites: 0 };
    });
    fake.client.appsReportAll.mockImplementation(async () => ({
      apps: [
        { app: "beta-notes", name: "Notes", package: null },
        { app: "beta-big", name: "Archive", package: null },
      ].filter((a) => !moved.has(a.app)),
    }));
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.change(await screen.findByTestId("merge-source"), { target: { value: BETA } });
    await screen.findByTestId("merge-apps");
    fireEvent.click(screen.getByTestId("merge-move"));
    const name = (await screen.findByTestId("merge-delete-name")) as HTMLInputElement;
    const del = screen.getByTestId("merge-delete") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "beta" } });
    expect(del.disabled).toBe(true);
    fireEvent.change(name, { target: { value: "Beta" } });
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    await waitFor(() => expect(fake.client.deleteOrg).toHaveBeenCalledWith(BETA, expect.anything()));
    expect((await screen.findByTestId("merge-deleted")).textContent).toContain("Beta is deleted");
  });

  it("tells an admin who does not own the source that only its owner deletes it", async () => {
    const fake = open({ as: "owner", otherOrgs: [{ ...beta, role: "admin" }], betaRole: "admin" });
    fake.client.appsReportAll.mockResolvedValue({ apps: [] });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.change(await screen.findByTestId("merge-source"), { target: { value: BETA } });
    expect((await screen.findByTestId("merge-empty")).textContent).toContain("Beta holds no apps");
    expect(screen.getByTestId("merge-keep").textContent).toContain("Only Beta's owner can delete it");
    expect(screen.queryByTestId("merge-delete")).toBeNull();
  });
});
