// The launcher's screens against a mocked CalimeroClient: sign in, the world
// list, a pending invitation, creating a world, inviting into the last one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Connection } from "../src/net/session";
import { Landing, type LaunchChoice } from "../src/ui/landing";
import { SessionStore } from "@calimero-apps/connect";

const target = { kind: "local", nodes: ["http://127.0.0.1:2501"] } as const;

function fakeClient(signedIn: boolean) {
  const client = {
    session: signedIn ? { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" } : null,
    signIn: vi.fn(async () => {
      client.session = { accountId: "acct-ada", sessionToken: "s", expiresAt: 1, refreshToken: "r" };
      return client.session;
    }),
    signUp: vi.fn(),
    signOut: vi.fn(async () => {}),
    useSession: vi.fn(),
    listApps: vi.fn(async () => [
      { appId: "w-1", name: "caves", org: "org-1", owner: "o", bundle: "b", package: null, version: null },
    ]),
    redeemInvite: vi.fn(async () => ({})),
    createOrg: vi.fn(async () => "org-new"),
    createApp: vi.fn(async () => "w-new"),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(),
    invite: vi.fn(async () => "tok-9"),
  };
  return client;
}

function launcher(signedIn: boolean, setup?: (client: ReturnType<typeof fakeClient>) => void) {
  const client = fakeClient(signedIn);
  setup?.(client);
  const conn = new Connection(
    client as never,
    target as never,
    new SessionStore("merraria", target as never, localStorage),
    () => ({}) as never,
    localStorage,
  );
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const landing = new Landing(parent, conn, "bundle-hash");
  const chosen = landing.show({ name: "Ada", seed: 1337 });
  const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    parent.querySelector<T>(`[data-testid="${id}"]`);
  return { client, conn, parent, chosen, $ };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("the launcher", () => {
  it("signs in with a passkey, then lists the account's worlds", async () => {
    const { client, $ } = launcher(false);
    expect($("sign-in-btn")).not.toBeNull();
    $("sign-in-btn")!.click();
    await settle();
    expect(client.signIn).toHaveBeenCalledTimes(1);
    await settle();
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect($("world-card-0")?.textContent).toContain("caves");
    expect($("account-badge")?.textContent).toContain("acct-ada");
  });

  it("enters a listed world and remembers it as the last played", async () => {
    const { conn, chosen, $ } = launcher(true);
    await settle();
    $("join-world-0")!.click();
    const choice: LaunchChoice = await chosen;
    expect(choice).toEqual({ name: "Ada", world: { appId: "w-1", name: "caves", org: "org-1" } });
    expect(JSON.parse(localStorage.getItem(conn.scopedKey("current-world")!)!)).toEqual(choice.world);
  });

  it("redeems an invitation opened before signing in, and says so", async () => {
    localStorage.setItem("merraria:pending-invite", "tok-1");
    const { client, $ } = launcher(true);
    await settle();
    await settle();
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
    expect(localStorage.getItem("merraria:pending-invite")).toBeNull();
    expect($("notice")?.textContent).toContain("Invitation accepted");
  });

  it("signed out with a pending invite, the launcher is the invitation, with Not now", async () => {
    localStorage.setItem("merraria:pending-invite", "tok-1");
    const { $ } = launcher(false);
    expect($("invite-waiting")?.textContent).toContain(
      "You've been invited to join a world in Merraria. Sign in or create an account to accept.",
    );
    expect($("sign-in-btn")).not.toBeNull();
    expect($("sign-up-btn")).not.toBeNull();
    expect($("invite-not-now")).not.toBeNull();
  });

  it("signing in from the invitation redeems it and says so", async () => {
    localStorage.setItem("merraria:pending-invite", "tok-1");
    const { client, $ } = launcher(false);
    $("sign-in-btn")!.click();
    await settle();
    await settle();
    await settle();
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
    expect($("notice")?.textContent).toContain("Invitation accepted");
  });

  it("does not redeem an invitation into a world the player is already in", async () => {
    localStorage.setItem("merraria:pending-invite", "tok-1");
    localStorage.setItem("merraria:pending-invite-org", "org-1");
    const { client, $ } = launcher(true, (c) => {
      (c as unknown as { me: () => Promise<unknown> }).me = vi.fn(async () => ({ orgs: [{ orgId: "org-1" }] }));
    });
    await settle();
    await settle();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem("merraria:pending-invite")).toBeNull();
    expect($("notice")?.textContent).toContain("You're already in this world");
  });

  it("says plainly when the invite was already used or has expired", async () => {
    localStorage.setItem("merraria:pending-invite", "tok-1");
    const { CalimeroError } = await import("@calimero-network/mero-js");
    const { $ } = launcher(true, (c) => {
      c.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    });
    await settle();
    await settle();
    expect($("notice")?.textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem("merraria:pending-invite")).toBeNull();
  });

  it("creates a world: an org, the instance, then createWorld with the seed", async () => {
    const { client, chosen, $ } = launcher(true);
    await settle();
    $("create-world-open-btn")!.click();
    $<HTMLInputElement>("world-name-input")!.value = "mesa";
    $<HTMLInputElement>("seed-input")!.value = "42";
    $("create-world-btn")!.click();
    const choice = await chosen;
    expect(choice.world).toEqual({ appId: "w-new", name: "mesa", org: "org-new" });
    expect(client.createApp).toHaveBeenCalledWith("mesa", "bundle-hash", { org: "org-new" });
    expect(client.call).toHaveBeenCalledWith("w-new", "createWorld", expect.objectContaining({ name: "mesa", seed: 42 }));
  });

  it("invites friends into the world last played, as a link with the org invite", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const first = launcher(true);
    localStorage.setItem(first.conn.scopedKey("current-world")!, JSON.stringify({ appId: "w-1", name: "caves", org: "org-1" }));
    document.body.innerHTML = "";
    const { client, $ } = launcher(true);
    await settle();
    $("invite-btn")!.click();
    await settle();
    await settle();
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("?invite=tok-9"));
  });
});
