import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { giveAllPlan, loadOrg, mayChangeSeat, removeAllPlan, runEach, seatsFor, type OrgApp, type Person } from "../home";
import { BLOCKS, CHAT, ORG, fakeOrg, passkey, type FakeOrgOptions } from "../test/fakeOrg";
import { People } from "./People";

afterEach(cleanup);

async function open(opts: FakeOrgOptions = {}) {
  const fake = fakeOrg(opts);
  const view = await loadOrg(fake.asClient, ORG, fake.me);
  const onChanged = vi.fn();
  render(<People client={fake.asClient} view={view} account={fake.me} passkey={passkey} after={() => {}} onChanged={onChanged} />);
  await screen.findByTestId("person-acct-bob");
  // The rows are read: the bulk buttons are enabled from then on.
  const bulk = screen.queryAllByTestId(/^give-all-/)[0] as HTMLButtonElement | undefined;
  if (bulk) await waitFor(() => expect(bulk.disabled).toBe(false));
  return { fake, view, onChanged };
}

describe("People: who is in each app, set from the matrix", () => {
  it("an admin puts someone in a closed app, as a member", async () => {
    const { fake, onChanged } = await open();
    const seat = (await screen.findByTestId(`seat-${BLOCKS}-acct-cat`)) as HTMLSelectElement;
    expect(seat.value).toBe("none");
    fireEvent.change(seat, { target: { value: "member" } });
    await waitFor(() =>
      expect(fake.client.setTeamMember).toHaveBeenCalledWith(ORG, "t-blocks", "acct-cat", expect.anything(), { role: "member" }),
    );
    expect((await screen.findByTestId("people-notice")).textContent).toMatch(/ is in Blocks: Member\.$/);
    expect(onChanged).toHaveBeenCalled();
    // The rows are read again.
    await waitFor(() => expect(fake.client.getTeam.mock.calls.filter((c) => c[1] === "t-blocks").length).toBeGreaterThan(1));
  });

  it("No takes someone out of that app only, never out of the org", async () => {
    const { fake } = await open();
    const seat = (await screen.findByTestId(`seat-${CHAT}-acct-bob`)) as HTMLSelectElement;
    await waitFor(() => expect(seat.value).toBe("member"));
    fireEvent.change(seat, { target: { value: "none" } });
    await waitFor(() => expect(fake.client.removeTeamMember).toHaveBeenCalledWith(ORG, "t-chat", "acct-bob", expect.anything()));
    expect(fake.client.removeMember).not.toHaveBeenCalled();
    expect((await screen.findByTestId("people-notice")).textContent).toBe("Bob was taken out of Chat.");
  });

  it("makes someone an app's lead", async () => {
    const { fake } = await open();
    const seat = (await screen.findByTestId(`seat-${CHAT}-acct-bob`)) as HTMLSelectElement;
    await waitFor(() => expect(seat.value).toBe("member"));
    fireEvent.change(seat, { target: { value: "lead" } });
    await waitFor(() =>
      expect(fake.client.setTeamMember).toHaveBeenCalledWith(ORG, "t-chat", "acct-bob", expect.anything(), { role: "lead" }),
    );
  });

  it("a refusal is said, and the cell keeps what the node holds", async () => {
    const { fake } = await open();
    fake.client.setTeamMember.mockRejectedValueOnce(new Error("not allowed to manage this team"));
    const seat = (await screen.findByTestId(`seat-${BLOCKS}-acct-cat`)) as HTMLSelectElement;
    fireEvent.change(seat, { target: { value: "member" } });
    expect((await screen.findByTestId("seat-error")).textContent).toContain("not allowed");
    expect(seat.value).toBe("none");
  });

  it("a guest can be given an app, never made its lead", async () => {
    await open();
    const seat = await screen.findByTestId(`seat-${BLOCKS}-acct-gus`);
    expect(within(seat).getAllByRole("option").map((o) => o.textContent)).toEqual(["No", "Member", "Read only"]);
  });

  it("an app's lead sets its people, and only its; a member sets nobody's", async () => {
    await open({ as: "lead" });
    // Bob leads Chat: Chat's cells are his to change, but not his own row; Blocks' are not.
    expect(await screen.findByTestId(`seat-${CHAT}-acct-gus`)).toBeTruthy();
    expect(screen.queryByTestId(`seat-${CHAT}-acct-bob`)).toBeNull();
    expect(screen.queryByTestId(`seat-${BLOCKS}-acct-gus`)).toBeNull();
    cleanup();
    await open({ as: "member" });
    expect(screen.queryAllByRole("combobox")).toEqual([]);
  });

  it("an open app (everyone in the org) and a legacy app have no list to set", async () => {
    await open({ mode: "standalone" });
    expect(screen.queryByTestId(`seat-${CHAT}-acct-bob`)).toBeNull();
  });
});

describe("People: give all apps / remove from all apps", () => {
  const skipped = () => screen.queryAllByTestId(/^bulk-skipped-/).map((li) => li.textContent);

  it("an admin gives someone every closed app, as a member, one passkey each, and says what it skipped", async () => {
    const { fake, onChanged } = await open();
    fireEvent.click(screen.getByTestId("give-all-acct-cat"));
    expect(screen.getByTestId("bulk-plan").textContent).toContain("Blocks, Chat");
    expect(screen.getByTestId("bulk-plan").textContent).toContain("asked 2 times, once per app");
    expect(skipped()).toEqual(["Mero Crm: everyone in the organization has it"]);
    fireEvent.click(screen.getByTestId("bulk-confirm-yes"));
    expect((await screen.findByTestId("bulk-done")).textContent).toBe("Added to Blocks, Chat.");
    expect(fake.client.setTeamMember.mock.calls.map((c) => [c[1], c[2], c[4]])).toEqual([
      ["t-blocks", "acct-cat", { role: "member" }],
      ["t-chat", "acct-cat", { role: "member" }],
    ]);
    expect(onChanged).toHaveBeenCalled();
    expect(skipped()).toEqual(["Mero Crm: everyone in the organization has it"]);
  });

  it("leaves an app they are in as it is", async () => {
    const { fake } = await open();
    await waitFor(() => expect((screen.getByTestId(`seat-${CHAT}-acct-bob`) as HTMLSelectElement).value).toBe("member"));
    fireEvent.click(screen.getByTestId("give-all-acct-bob"));
    expect(skipped()).toContain("Chat: already in it (Member)");
    fireEvent.click(screen.getByTestId("bulk-confirm-yes"));
    await screen.findByTestId("bulk-done");
    expect(fake.client.setTeamMember.mock.calls.map((c) => c[1])).toEqual(["t-blocks"]);
  });

  it("shows progress, one app at a time", async () => {
    const { fake } = await open();
    let release!: () => void;
    fake.client.setTeamMember.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    fireEvent.click(screen.getByTestId("give-all-acct-cat"));
    fireEvent.click(screen.getByTestId("bulk-confirm-yes"));
    expect((await screen.findByTestId("bulk-progress")).textContent).toBe("0 of 2 added: confirm Blocks with your passkey…");
    expect(fake.client.setTeamMember).toHaveBeenCalledTimes(1);
    release();
    await screen.findByTestId("bulk-done");
    expect(fake.client.setTeamMember).toHaveBeenCalledTimes(2);
  });

  it("stops at a refusal or a cancelled passkey, and says what was not tried", async () => {
    const { fake } = await open();
    fake.client.setTeamMember.mockRejectedValueOnce(new Error("The passkey prompt was cancelled."));
    fireEvent.click(screen.getByTestId("give-all-acct-cat"));
    fireEvent.click(screen.getByTestId("bulk-confirm-yes"));
    const failed = await screen.findByTestId("bulk-failed");
    expect(failed.textContent).toContain("Blocks was not added");
    expect(failed.textContent).toContain("Not tried: Chat.");
    expect(screen.queryByTestId("bulk-done")).toBeNull();
    expect(fake.client.setTeamMember).toHaveBeenCalledTimes(1);
  });

  it("removes someone from every app they are in, after a confirm, never from the org", async () => {
    const { fake } = await open();
    await waitFor(() => expect((screen.getByTestId(`seat-${CHAT}-acct-bob`) as HTMLSelectElement).value).toBe("member"));
    fireEvent.click(screen.getByTestId("remove-all-acct-bob"));
    expect(fake.client.removeTeamMember).not.toHaveBeenCalled();
    expect(screen.getByTestId("bulk-plan").textContent).toBe(
      "Bob leaves: Chat. They stay in the organization. Your passkey is asked once.",
    );
    expect(skipped()).toEqual(["Mero Crm: open to everyone in the organization: they keep it while they are in it"]);
    fireEvent.click(screen.getByTestId("bulk-confirm-yes"));
    expect((await screen.findByTestId("bulk-done")).textContent).toBe("Taken out of Chat.");
    expect(fake.client.removeTeamMember).toHaveBeenCalledWith(ORG, "t-chat", "acct-bob", expect.anything());
    expect(fake.client.removeTeamMember).toHaveBeenCalledTimes(1);
    expect(fake.client.removeMember).not.toHaveBeenCalled();
  });

  it("cancel changes nothing", async () => {
    const { fake } = await open();
    fireEvent.click(screen.getByTestId("give-all-acct-cat"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("bulk-panel")).toBeNull();
    expect(fake.client.setTeamMember).not.toHaveBeenCalled();
  });

  it("a lead gets the buttons, for the apps they lead only; a member and your own row get none", async () => {
    await open({ as: "lead" });
    expect(screen.queryByTestId("give-all-acct-bob")).toBeNull();
    fireEvent.click(screen.getByTestId("give-all-acct-gus"));
    expect(screen.getByTestId("bulk-nothing")).toBeTruthy();
    expect(skipped()).toEqual([
      "Blocks: you do not manage it",
      "Chat: already in it (Member)",
      "Mero Crm: everyone in the organization has it",
    ]);
    expect(screen.queryByTestId("bulk-confirm-yes")).toBeNull();
    cleanup();
    await open({ as: "member" });
    expect(screen.queryAllByTestId(/^give-all-|^remove-all-/)).toEqual([]);
    cleanup();
    await open({ as: "admin", mode: "standalone" });
    // Every app open: nothing to manage, so no bulk buttons, but an admin still removes from the org.
    expect(screen.queryAllByTestId(/^give-all-/)).toEqual([]);
    expect(screen.getByTestId("remove-acct-bob")).toBeTruthy();
  });
});

describe("giveAllPlan / removeAllPlan / runEach", () => {
  const team = (id: string, join: "everyone" | "invite", manages = false) => ({
    package: id,
    teamId: id,
    name: id,
    join,
    memberCount: 1,
    defaultCapabilities: null,
    member: false,
    manages,
  });
  const app = (id: string, join: "everyone" | "invite" | null, manages = false): OrgApp => ({
    package: id,
    name: id,
    instances: [],
    team: join ? team(id, join, manages) : null,
  });
  const gus: Person = { account: "gus", role: "guest", name: null };
  const view = {
    role: "member" as const,
    mode: "shared" as const,
    apps: [app("open", "everyone"), app("led", "invite", true), app("other", "invite"), app("unread", "invite", true)],
  };
  const rosters = new Map([
    ["led", new Map()],
    ["other", new Map([["gus", "member" as const]])],
  ]);

  it("plans per app, with why each skip", () => {
    expect(giveAllPlan(view, rosters, gus)).toEqual({
      apps: [view.apps[1]],
      skipped: [
        { app: view.apps[0], why: "open to everyone but guests: invite them to it" },
        { app: view.apps[2], why: "you do not manage it" },
        { app: view.apps[3], why: "its list could not be read" },
      ],
    });
    // Gus is not in "led": nothing to remove there; "other" is not the caller's.
    expect(removeAllPlan(view, rosters, gus)).toEqual({
      apps: [],
      skipped: [
        { app: view.apps[2], why: "you do not manage it" },
        { app: view.apps[3], why: "its list could not be read" },
      ],
    });
  });

  it("runs in turn and stops at the first failure", async () => {
    const seen: string[] = [];
    const result = await runEach(view.apps, async (a) => {
      seen.push(a.package);
      if (a.package === "led") throw new Error("no");
    });
    expect(seen).toEqual(["open", "led"]);
    expect(result.done.map((a) => a.package)).toEqual(["open"]);
    expect(result.failed?.app.package).toBe("led");
    expect(result.notTried.map((a) => a.package)).toEqual(["other", "unread"]);
  });
});

describe("mayChangeSeat / seatsFor", () => {
  const person = (account: string, role: Person["role"] = "member"): Person => ({ account, role, name: null });
  const app = (join: "everyone" | "invite", manages: boolean): OrgApp => ({
    package: CHAT,
    name: "Chat",
    instances: [],
    team: { package: CHAT, teamId: "t", name: "Chat", join, memberCount: 1, defaultCapabilities: null, member: true, manages },
  });
  const read = new Map([["t", new Map()]]);

  it("needs a closed team the caller manages, whose rows were read, and someone else's row", () => {
    expect(mayChangeSeat({ role: "member" }, app("invite", true), read, person("b"), "a")).toBe(true);
    expect(mayChangeSeat({ role: "admin" }, app("invite", false), read, person("b"), "a")).toBe(true);
    expect(mayChangeSeat({ role: "member" }, app("invite", false), read, person("b"), "a")).toBe(false);
    expect(mayChangeSeat({ role: "admin" }, app("everyone", true), read, person("b"), "a")).toBe(false);
    expect(mayChangeSeat({ role: "admin" }, app("invite", true), new Map(), person("b"), "a")).toBe(false);
    expect(mayChangeSeat({ role: "admin" }, app("invite", true), read, person("a"), "a")).toBe(false);
  });

  it("offers lead to everyone but a guest", () => {
    expect(seatsFor({ role: "guest" })).not.toContain("lead");
    expect(seatsFor({ role: "member" })).toContain("lead");
  });
});
