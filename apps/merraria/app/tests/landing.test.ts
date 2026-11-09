// The launcher's screens against a mocked CalimeroClient: sign in, the world
// list, a pending invitation, creating a world, inviting into the last one.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Connection } from "../src/net/session";
import { Landing, type LaunchChoice } from "../src/ui/landing";
import { SessionStore } from "@calimero-apps/connect";
import { SIGN_UP_NOT_FINISHED, SIGN_UP_READY } from "@calimero-apps/passkey/signUpFlow";
import type { PasskeyProvider } from "@calimero-network/mero-js";

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

function launcher(
  signedIn: boolean,
  setup?: (client: ReturnType<typeof fakeClient>) => void,
  passkey: () => PasskeyProvider = () => ({}) as never,
) {
  const client = fakeClient(signedIn);
  setup?.(client);
  const conn = new Connection(
    client as never,
    target as never,
    new SessionStore("merraria", target as never, localStorage),
    passkey,
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

describe("a sign-up's second prompt", () => {
  // Since core #4849 a sign-up takes two prompts. The second is asked right
  // after the first; it waits for Approve only when that failed or was refused
  // (a blocked prompt, Safari's user-gesture rule, a closed prompt).
  function signingUp(get: PasskeyProvider["get"]) {
    const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
    const l = launcher(
      false,
      (client) =>
        client.signUp.mockImplementation(async (p: PasskeyProvider) => {
          await p.create({} as never);
          await p.get(new Uint8Array([1]), "example.com", ["new-cred"]);
          return client.signIn();
        }),
      () => pk as unknown as PasskeyProvider,
    );
    return { pk, ...l };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  const notAllowed = (message = "The request is not allowed by the user agent.") =>
    Object.assign(new Error(message), { name: "NotAllowedError" });

  it("asks both prompts back to back, with no click, then lists the account's worlds", async () => {
    const { pk, client, $ } = signingUp(async () => ({}) as never);
    $("sign-up-btn")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Ada");
  });

  it("a second prompt refused at once waits for Approve, which then lists the worlds", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      return {} as never;
    });
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    expect($("signup-approve")?.textContent).toBe("Approve with your new passkey");
    expect($("signup-approve-note")?.textContent).toBe(SIGN_UP_READY);
    expect($("sign-up-btn")?.hidden).toBe(true);
    expect($("sign-in-error")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("a second prompt the person saw and closed shows the error with Approve, which then lists the worlds", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length > 1) return {} as never;
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    $("sign-up-btn")!.click();
    await until(() => $("sign-in-error")?.textContent === SIGN_UP_NOT_FINISHED);
    expect($<HTMLButtonElement>("signup-approve")?.disabled).toBe(false);
    expect($("signup-cancel")?.hidden).toBe(false);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("shows a second prompt refused after Approve and keeps Approve", async () => {
    const { pk, $ } = signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    $("signup-approve")!.click();
    await until(() => $("sign-in-error")?.textContent === SIGN_UP_NOT_FINISHED);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect($<HTMLButtonElement>("signup-approve")?.disabled).toBe(false);

    pk.get.mockImplementation(async () => ({}) as never);
    $("signup-approve")!.click();
    await until(() => $("account-badge") !== null);
  });

  it("Cancel at Approve resets quietly", async () => {
    const { pk, $ } = signingUp(async () => Promise.reject(notAllowed()));
    $("sign-up-btn")!.click();
    await until(() => $<HTMLButtonElement>("signup-approve")?.disabled === false && $("signup-approve-step")?.hidden === false);
    $("signup-cancel")!.click();
    await until(() => $("signup-approve-step")?.hidden === true);
    expect($("sign-up-btn")?.hidden).toBe(false);
    expect($<HTMLButtonElement>("sign-up-btn")?.disabled).toBe(false);
    expect($("sign-in-error")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
  });
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
