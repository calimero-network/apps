import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadOrg, mayChangeSeat, seatsFor, type OrgApp, type Person } from "../home";
import { BLOCKS, CHAT, ORG, fakeOrg, passkey, type FakeOrgOptions } from "../test/fakeOrg";
import { People } from "./People";

afterEach(cleanup);

async function open(opts: FakeOrgOptions = {}) {
  const fake = fakeOrg(opts);
  const view = await loadOrg(fake.asClient, ORG, fake.me);
  const onChanged = vi.fn();
  render(<People client={fake.asClient} view={view} account={fake.me} passkey={passkey} after={() => {}} onChanged={onChanged} />);
  await screen.findByTestId("person-acct-bob");
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
