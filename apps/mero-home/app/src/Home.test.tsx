import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { OrgInvite } from "@calimero-network/mero-js";

import { Home } from "./Home";
import { BLOCKS, CHAT, CRM, ORG, fakeOrg, passkey, type FakeOrgOptions } from "./test/fakeOrg";

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
    expect(await tabs()).toEqual(["Your apps", "People", "Invitations", "Admin"]);
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
    await waitFor(() => expect(within(bob).getAllByText("Yes").length).toBe(1));
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

describe("Admin", () => {
  it("turns 'members may invite' on for one app", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    const box = (await screen.findByTestId(`members-invite-${CHAT}`)) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    await waitFor(() => expect(fake.client.setTeamDefaultCapabilities).toHaveBeenCalledWith(ORG, "t-chat", 2, expect.anything()));
  });

  it("gives a legacy app its own access list, keeping everyone (open team)", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.click(await screen.findByTestId(`scope-${CRM}`));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: CRM, name: "Mero Crm" }],
        shared: false,
      }),
    );
  });

  it("adds an app as a shared, closed team with no instances, and links to open it", async () => {
    const fake = open({ as: "admin" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    const select = (await screen.findByTestId("add-app-package")) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["", CRM, "com.calimero.mero-sheets"]);
    fireEvent.change(select, { target: { value: "com.calimero.mero-sheets" } });
    expect((screen.getByTestId("add-app-shared") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByTestId("add-app"));
    await waitFor(() =>
      expect(fake.client.scopeApps).toHaveBeenCalledWith(ORG, expect.anything(), {
        apps: [{ package: "com.calimero.mero-sheets", name: "Mero Sheets", instances: [] }],
        shared: true,
      }),
    );
    expect((await screen.findByTestId("app-added")).textContent).toContain("Open Mero Sheets");
  });

  it("warns that adding a shared app closes the open ones", async () => {
    open({ as: "admin", mode: "standalone" });
    fireEvent.click(await screen.findByTestId("tab-admin"));
    fireEvent.change(await screen.findByTestId("add-app-package"), { target: { value: CRM } });
    expect(screen.getByTestId("add-app-closes").textContent).toContain("Chat will become invite-only");
  });
});
