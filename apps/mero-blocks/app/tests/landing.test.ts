// The launcher's screens with a mocked CalimeroClient: sign in, the world
// list, creating a world, entering one, an invite link redeemed after sign-in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, CalimeroClient, CalimeroSession, PasskeyProvider } from "@calimero-network/mero-js";
import { SIGN_UP_NOT_FINISHED, SIGN_UP_READY } from "@calimero-apps/passkey/signUpFlow";
import { SIGN_IN_HINT, accountHintKey, noAccountCopy } from "@calimero-apps/passkey/ceremony";
import { CalimeroError, SignUpRefused } from "@calimero-network/mero-js";
import { createInviteStore, resolveTarget, type InviteStore, type PendingInvite } from "@calimero-apps/connect";

vi.mock("../src/ui/panorama", () => ({ Panorama: class { destroy() {} } }));
vi.mock("../src/pages/landing/mount", () => ({ showLandingAgain: vi.fn(async () => {}) }));

import { connect, type Phase, type SessionDeps } from "../src/net/session";
import { Landing, type LaunchChoice } from "../src/ui/landing";

const SESSION: CalimeroSession = { accountId: "acc-1", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const ENV = { DEV: true, VITE_CALIMERO_TARGET: "local", VITE_CALIMERO_BUNDLE: "bundle-1" };

const world = (appId: string, name: string, org: string | null): AppInfo => ({
  appId,
  name,
  org,
  owner: "acc-1",
  bundle: "bundle-1",
  package: null,
  version: null,
});

function fakeClient(worlds: AppInfo[]) {
  let session: CalimeroSession | undefined;
  // org → account → member metadata
  const members: Record<string, Record<string, Record<string, unknown>>> = {};
  return {
    members,
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => (session = s)),
    signIn: vi.fn(async () => (session = SESSION)),
    signUp: vi.fn(async () => (session = SESSION)),
    signOut: vi.fn(async () => (session = undefined)),
    listApps: vi.fn(async () => worlds),
    createOrg: vi.fn(async () => "org-new"),
    createApp: vi.fn(async () => "app-new"),
    invite: vi.fn(async () => "tok"),
    redeemInvite: vi.fn(async () => ({ org: "org-2" })),
    getOrg: vi.fn(async (org: string) => ({ memberMetadata: members[org] ?? {} })),
    setMemberMetadata: vi.fn(async (org: string, account: string, meta: Record<string, unknown>) => {
      (members[org] ??= {})[account] = meta;
    }),
  };
}

async function launcher(
  worlds: AppInfo[],
  storage = localStorage,
  passkey: () => PasskeyProvider = () => ({}) as never,
  setup?: (client: ReturnType<typeof fakeClient>) => void,
) {
  const client = fakeClient(worlds);
  setup?.(client);
  const deps: SessionDeps = {
    env: ENV,
    storage,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey,
  };
  const phase: Phase = await connect(deps);
  const app = document.createElement("div");
  document.body.appendChild(app);
  const choice = new Landing(app, deps, invites).show(phase, { name: "Steve", seed: 1337 });
  return { client, app, choice };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const click = (el: Element | null) => (el as HTMLElement).click();
const q = (sel: string) => document.querySelector(sel);

/** The launcher's pending-invite store, on the page's storage as in the browser. */
let invites: InviteStore;
/** An invite link opened before the launcher: what `main.ts` leaves in the store. */
function invited(token: string, more: Partial<PendingInvite> = {}) {
  invites.put({ token, org: null, team: null, doc: null, route: null, extra: {}, ...more });
}

beforeEach(() => {
  localStorage.clear();
  invites = createInviteStore("mero-blocks", { storage: localStorage, keep: ["world", "from"] });
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("a sign-up's second prompt", () => {
  // Since core #4849 a sign-up takes two prompts. The second is asked right
  // after the first; it waits for Approve only when that failed or was refused
  // (a blocked prompt, Safari's user-gesture rule, a closed prompt).
  async function signingUp(get: PasskeyProvider["get"]) {
    const pk = { create: vi.fn(async () => ({}) as never), get: vi.fn(get) };
    const l = await launcher(
      [world("app-a", "alpha", "org-a")],
      localStorage,
      () => pk as unknown as PasskeyProvider,
      (client) =>
        client.signUp.mockImplementation((async (p: PasskeyProvider) => {
          await p.create({} as never);
          await p.get(new Uint8Array([1]), "example.com", ["new-cred"]);
          return client.signIn();
        }) as never),
    );
    return { pk, ...l };
  }
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  const shown = (id: string) => (q(`[data-testid=${id}]`) as HTMLElement | null)?.hidden === false;

  const notAllowed = (message = "The request is not allowed by the user agent.") =>
    Object.assign(new Error(message), { name: "NotAllowedError" });
  const atApprove = () =>
    shown("signup-approve-step") && (q("[data-testid=signup-approve]") as HTMLButtonElement).disabled === false;

  it("asks both prompts back to back, with no click, then lists the account's worlds", async () => {
    const { pk, client } = await signingUp(async () => ({}) as never);
    click(q("[data-testid=sign-up-btn]"));
    await until(() => document.querySelectorAll(".mbl-card-title").length > 0);
    expect(pk.create).toHaveBeenCalledTimes(1);
    expect(pk.get).toHaveBeenCalledTimes(1);
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Steve");
  });

  it("a second prompt refused at once waits for Approve, which then lists the worlds", async () => {
    const { pk } = await signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      return {} as never;
    });
    click(q("[data-testid=sign-up-btn]"));
    await until(atApprove);
    expect(q("[data-testid=signup-approve]")?.textContent).toBe("Approve with your new passkey");
    expect(q("[data-testid=signup-approve-note]")?.textContent).toBe(SIGN_UP_READY);
    expect(shown("sign-up-btn")).toBe(false);
    expect(q("[data-testid=sign-in-error]")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
    click(q("[data-testid=signup-approve]"));
    await until(() => document.querySelectorAll(".mbl-card-title").length > 0);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("a second prompt the person saw and closed shows the error with Approve, which then lists the worlds", async () => {
    const { pk } = await signingUp(async () => {
      if (pk.get.mock.calls.length > 1) return {} as never;
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    click(q("[data-testid=sign-up-btn]"));
    await until(() => q("[data-testid=sign-in-error]")?.textContent === SIGN_UP_NOT_FINISHED);
    expect(atApprove()).toBe(true);
    click(q("[data-testid=signup-approve]"));
    await until(() => document.querySelectorAll(".mbl-card-title").length > 0);
    expect(pk.get).toHaveBeenCalledTimes(2);
  });

  it("shows a second prompt refused after Approve and keeps Approve", async () => {
    const { pk } = await signingUp(async () => {
      if (pk.get.mock.calls.length === 1) throw notAllowed();
      await new Promise((r) => setTimeout(r, 1100)); // a prompt the person saw
      throw notAllowed("The operation either timed out or was not allowed.");
    });
    click(q("[data-testid=sign-up-btn]"));
    await until(atApprove);
    click(q("[data-testid=signup-approve]"));
    await until(() => q("[data-testid=sign-in-error]")?.textContent === SIGN_UP_NOT_FINISHED);
    expect(pk.get).toHaveBeenCalledTimes(2);
    expect((q("[data-testid=signup-approve]") as HTMLButtonElement).disabled).toBe(false);

    pk.get.mockImplementation(async () => ({}) as never);
    click(q("[data-testid=signup-approve]"));
    await until(() => document.querySelectorAll(".mbl-card-title").length > 0);
  });

  it("Cancel at Approve resets quietly", async () => {
    const { pk } = await signingUp(async () => Promise.reject(notAllowed()));
    click(q("[data-testid=sign-up-btn]"));
    await until(atApprove);
    click(q("[data-testid=signup-cancel]"));
    await until(() => !shown("signup-approve-step"));
    expect(shown("sign-up-btn")).toBe(true);
    expect((q("[data-testid=sign-up-btn]") as HTMLButtonElement).disabled).toBe(false);
    expect(q("[data-testid=sign-in-error]")?.textContent).toBe("");
    expect(pk.get).toHaveBeenCalledTimes(1);
  });
});

describe("launcher", () => {
  it("signs in with a passkey, lists the account's worlds and enters one", async () => {
    // A world from before names lived on the org: the old launcher name is adopted, not asked.
    localStorage.setItem("mb-name", "Steve");
    const { client, choice } = await launcher([world("app-b", "beta", "org-b"), world("app-a", "alpha", "org-a")]);
    expect(q("[data-testid=target]")?.textContent).toBe("merod local (3 nodes)");
    click(q("[data-testid=sign-in-btn]"));
    await flush();
    await flush();
    expect(client.signIn).toHaveBeenCalled();
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-1" });
    const titles = [...document.querySelectorAll(".mbl-card-title")].map((e) => e.textContent);
    expect(titles).toEqual(["alpha", "beta"]);

    click(q("[data-testid=join-world-1]"));
    const entered: LaunchChoice = await choice;
    expect(entered.world).toEqual({ appId: "app-b", name: "beta", org: "org-b" });
    expect(entered.name).toBe("Steve");
    expect(entered.session.accountId).toBe("acc-1");
    expect(q("[data-testid=name-modal]")).toBeNull();
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-b", "acc-1", { name: "Steve" });
  });

  it("enters a world whose org has the player's name without asking, as that name", async () => {
    localStorage.setItem("mb-name", "Old");
    const { client, choice } = await launcher([world("app-a", "alpha", "org-a")], localStorage, undefined, (c) => {
      c.members["org-a"] = { "acc-1": { name: "Alex" } };
    });
    expect(q("[data-testid=name-input]")).toBeNull();
    click(q("[data-testid=sign-in-btn]"));
    await flush();
    await flush();
    click(q("[data-testid=join-world-0]"));
    const entered = await choice;
    expect(entered.name).toBe("Alex");
    expect(q("[data-testid=name-modal]")).toBeNull();
    expect(client.setMemberMetadata).not.toHaveBeenCalled();
  });

  it("changes the player's name in a world's org from the card menu", async () => {
    const { client } = await launcher([world("app-a", "alpha", "org-a")], localStorage, undefined, (c) => {
      c.members["org-a"] = { "acc-1": { name: "Alex", color: "red" } };
    });
    click(q("[data-testid=sign-in-btn]"));
    await flush();
    await flush();
    click(q("[data-testid=world-card-0] [data-action=rename]"));
    await flush();
    const input = q("[data-testid=name-modal] input") as HTMLInputElement;
    expect(input.value).toBe("Alex");
    input.value = "Alexa";
    click(q("[data-testid=name-save-btn]"));
    await flush();
    await flush();
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-a", "acc-1", { name: "Alexa", color: "red" });
  });

  it("puts the world last played first, with Enter and an invite button", async () => {
    localStorage.setItem("mb-name", "Steve");
    const { client, choice } = await launcher([world("app-a", "alpha", "org-a"), world("app-b", "beta", "org-b")]);
    click(q("[data-testid=sign-in-btn]"));
    await flush();
    await flush();
    // Enter the second world, then reopen the launcher: it is "last played".
    click(q("[data-testid=join-world-1]"));
    await choice;
    document.body.innerHTML = "";
    const again = await launcher([world("app-a", "alpha", "org-a"), world("app-b", "beta", "org-b")]);
    await flush();
    await flush();
    expect(q("[data-testid=world-card-current] .mbl-card-title")?.textContent).toBe("beta");
    const invite = q("[data-testid=invite-btn]") as HTMLButtonElement;
    expect(invite.hidden).toBe(false);
    expect(client.signIn).toHaveBeenCalledTimes(1);
    void again.choice;
  });

  it("creates a world in its own org with the seed typed, and enters it", async () => {
    const { client, choice } = await launcher([]);
    click(q("[data-testid=sign-up-btn]"));
    await flush();
    await flush();
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Steve");
    expect(q("[data-testid=world-list]")?.textContent).toContain("No worlds yet");
    click(q("[data-testid=create-world-open-btn]"));
    (q("#mbl-world-name") as HTMLInputElement).value = "castle";
    (q("#mbl-seed") as HTMLInputElement).value = "42";
    // The name is asked here, once, and lives on the world's org.
    expect((q("[data-testid=self-name-input]") as HTMLInputElement).value).toBe("Steve");
    (q("[data-testid=self-name-input]") as HTMLInputElement).value = "Alex";
    click(q("[data-testid=create-world-btn]"));
    const entered = await choice;
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", "acc-1", { name: "Alex" });
    expect(entered.name).toBe("Alex");
    expect(q("[data-testid=name-modal]")).toBeNull();
    expect(client.createOrg).toHaveBeenCalledWith("castle");
    expect(client.createApp).toHaveBeenCalledWith("castle", "bundle-1", {
      org: "org-new",
      initArgs: expect.objectContaining({ name: "castle", seed: "42" }),
    });
    expect(entered.world).toEqual({ appId: "app-new", name: "castle", org: "org-new" });
  });

  describe("an invite link, once signed in", () => {
    const until = async (check: () => boolean) => {
      for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
      expect(check()).toBe(true);
    };
    const asked = () => q("[data-testid=invite-confirm]") !== null;
    const listed = () => document.querySelectorAll(".mbl-card-title").length > 0;

    // Just joined: the world's org has no name for this player yet, asked once.
    const named = async (name: string) => {
      await until(() => q("[data-testid=name-modal]") !== null);
      (q("[data-testid=name-modal] input") as HTMLInputElement).value = name;
      click(q("[data-testid=name-save-btn]"));
    };

    it("asks which account joins whose game, and redeems nothing until Join", async () => {
      invited("tok-1", { extra: { from: "Alex" } });
      localStorage.setItem("calimero-names:last", "Alex");
      const { client, choice } = await launcher([world("app-1", "mine", "org-1"), world("app-2", "theirs", "org-2")]);
      expect(q("[data-testid=invite-note]")).not.toBeNull();
      click(q("[data-testid=sign-in-btn]"));
      await until(asked);
      expect(q("[data-testid=invite-question]")?.textContent).toBe("Join Alex's game as acc-1?");
      await new Promise((r) => setTimeout(r, 30));
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(listed()).toBe(false);

      click(q("[data-testid=invite-join]"));
      // Your name in the world's org, asked once, prefilled with the last one used.
      await until(() => q("[data-testid=name-modal]") !== null);
      expect((q("[data-testid=name-modal] input") as HTMLInputElement).value).toBe("Alex");
      await named("Sam");
      const entered = await choice;
      expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
      expect(entered.name).toBe("Sam");
      expect(client.setMemberMetadata).toHaveBeenCalledWith("org-2", "acc-1", { name: "Sam" });
      // The world of the org it joined opens.
      expect(entered.world.appId).toBe("app-2");
      expect(invites.token()).toBeNull();
    });

    it("a session restored on load asks too, and enters the world the link names", async () => {
      // Signed in on an earlier visit.
      const first = await launcher([]);
      click(q("[data-testid=sign-in-btn]"));
      await until(() => q("[data-testid=create-world-open-btn]") !== null);
      void first.choice;
      document.body.innerHTML = "";

      invited("tok-1", { org: "org-2", extra: { world: "app-3" } });
      const { client, choice } = await launcher([
        world("app-2", "theirs", "org-2"),
        world("app-3", "their other", "org-2"),
      ], localStorage, undefined, (c) => {
        // Not in org-2 until the invite is redeemed.
        let joined = false;
        const all = c.listApps.getMockImplementation()!;
        c.listApps.mockImplementation(async () => (joined ? all() : []));
        c.redeemInvite.mockImplementation(async () => {
          joined = true;
          return { org: "org-2" };
        });
      });
      await until(asked);
      expect(q("[data-testid=invite-question]")?.textContent).toBe("Join the game as acc-1?");
      expect(client.redeemInvite).not.toHaveBeenCalled();
      click(q("[data-testid=invite-join]"));
      await named("Sam");
      expect((await choice).world.appId).toBe("app-3");
    });

    it("Not now joins nothing, forgets the invite and lists the player's worlds", async () => {
      invited("tok-1");
      const { client } = await launcher([world("app-1", "mine", "org-1")]);
      click(q("[data-testid=sign-in-btn]"));
      await until(asked);
      click(q("[data-testid=invite-not-now]"));
      await until(listed);
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
      expect(asked()).toBe(false);
    });

    it.each([
      [401, "UNAUTHORIZED", "session expired"],
      [429, "RATE_LIMITED", "too many requests"],
      [503, "UNAVAILABLE", "try later"],
    ])("keeps the invite and the question when the redemption fails with %i", async (status, code, message) => {
      invited("tok-1");
      const { client } = await launcher([world("app-1", "mine", "org-1")], localStorage, undefined, (c) =>
        c.redeemInvite.mockRejectedValue(new CalimeroError(status, code, message)),
      );
      click(q("[data-testid=sign-in-btn]"));
      await until(asked);
      click(q("[data-testid=invite-join]"));
      await until(() => /invite is kept/i.test(q("[data-testid=invite-error]")?.textContent ?? ""));
      expect(client.redeemInvite).toHaveBeenCalledTimes(1);
      expect(invites.token()).toBe("tok-1");
      expect(q("[data-testid=invite-join]")?.textContent).toBe("Try again");
    });

    it("a network failure keeps the invite too", async () => {
      invited("tok-1");
      await launcher([], localStorage, undefined, (c) => c.redeemInvite.mockRejectedValue(new TypeError("Failed to fetch")));
      click(q("[data-testid=sign-in-btn]"));
      await until(asked);
      click(q("[data-testid=invite-join]"));
      await until(() => /invite is kept/i.test(q("[data-testid=invite-error]")?.textContent ?? ""));
      expect(invites.token()).toBe("tok-1");
    });

    it("drops an invite the node refuses for good, says so and lists the worlds", async () => {
      invited("tok-1");
      await launcher([world("app-1", "mine", "org-1")], localStorage, undefined, (c) =>
        c.redeemInvite.mockRejectedValue(new CalimeroError(400, "REJECTED", "invite was used up, revoked or never existed")),
      );
      click(q("[data-testid=sign-in-btn]"));
      await until(asked);
      click(q("[data-testid=invite-join]"));
      await until(listed);
      expect(q("[data-testid=account-note]")?.textContent).toContain("already used or has expired");
      expect(invites.token()).toBeNull();
    });

    it("signing out drops the pending invite, so the next person is not asked to join", async () => {
      // Signed in, the invite answered "Not now" for once in another tab: simulate one kept.
      const first = await launcher([]);
      click(q("[data-testid=sign-in-btn]"));
      await until(() => q("[data-testid=sign-out-btn]") !== null);
      invited("tok-1");
      click(q("[data-testid=sign-out-btn]"));
      await until(() => q("[data-testid=sign-in-btn]") !== null);
      expect(invites.token()).toBeNull();
      expect(q("[data-testid=invite-note]")).toBeNull();
      void first.choice;
    });

    it("another account signing in on this browser drops an invite held for the first", async () => {
      invited("tok-1");
      invites.signedIn("acc-other");
      const { client } = await launcher([world("app-1", "mine", "org-1")]);
      click(q("[data-testid=sign-in-btn]"));
      await until(listed);
      expect(asked()).toBe(false);
      expect(client.redeemInvite).not.toHaveBeenCalled();
      expect(invites.token()).toBeNull();
    });
  });

  it("words the sign-in as the invitation when a link is waiting", async () => {
    invited("tok-1");
    await launcher([]);
    expect(q("[data-testid=invite-note]")?.textContent).toBe(
      "You've been invited to join a world in Mero Blocks. Sign in or create an account to accept.",
    );
  });

  it("enters a world the player is already in without spending the link", async () => {
    invited("tok-1", { org: "org-1" });
    const { client, choice } = await launcher([world("app-1", "mine", "org-1")], localStorage, undefined, (c) => {
      c.members["org-1"] = { "acc-1": { name: "Alex" } };
    });
    click(q("[data-testid=sign-in-btn]"));
    const entered = await choice;
    expect(entered.world.appId).toBe("app-1");
    expect(entered.name).toBe("Alex");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("shows the shared listing on a copy no cluster serves, not a developer error", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);
    void new Landing(app).show({ status: "listing", message: "VITE_CALIMERO_CLUSTER is not set" }, { name: "x", seed: 1 });
    const open = q("[data-testid=listing-open]") as HTMLAnchorElement | null;
    expect(open?.textContent).toBe("Open Mero Blocks");
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-blocks")`.
    expect(open?.getAttribute("href")).toBe("https://k3fyuodnomq2d2i3woo47t6blm42ur6mfy4icg4rsaxtkujph2vq.apps.calimero.network/");
    expect(q("[data-testid=listing-deploy]")?.getAttribute("href")).toBe("https://cloud.calimero.network/v2");
    expect(q("#mbl-play")?.textContent).not.toContain("VITE_CALIMERO_CLUSTER");
  });

  it("shows why a build that cannot connect otherwise fails", async () => {
    const app = document.createElement("div");
    document.body.appendChild(app);
    void new Landing(app).show({ status: "unconfigured", message: "VITE_CALIMERO_MIN_RELEASE is not set" }, { name: "x", seed: 1 });
    expect(q("[data-testid=unconfigured]")?.textContent).toContain("VITE_CALIMERO_MIN_RELEASE");
  });

  it("says why a sign-in failed and lets the player try again", async () => {
    const { client } = await launcher([]);
    client.signIn.mockRejectedValueOnce(new Error("The passkey prompt was cancelled."));
    click(q("[data-testid=sign-in-btn]"));
    await flush();
    expect(q("[data-testid=sign-in-error]")?.textContent).toContain("cancelled");
    expect((q("[data-testid=sign-in-btn]") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("one sign-in everywhere (@calimero-apps/passkey)", () => {
  const OPEN = { policy: "open", orgInvites: true, signUpInvites: true, inviteRequired: false };
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
    expect(check()).toBe(true);
  };
  const listed = () => document.querySelectorAll(".mbl-card-title").length > 0;
  async function withPasskey(worlds: AppInfo[], setup?: (client: ReturnType<typeof fakeClient>) => void) {
    const pk = {
      create: vi.fn(async () => ({}) as never),
      get: vi.fn(async (..._args: unknown[]) => ({ credentialId: "cred-here" }) as never),
    };
    const l = await launcher(worlds, localStorage, () => pk as unknown as PasskeyProvider, (client) => {
      const signedIn = client.signIn.getMockImplementation()!;
      client.signIn.mockImplementation((async (p: PasskeyProvider) => {
        await p.get(new Uint8Array([1]), "calimero.network");
        return signedIn();
      }) as never);
      Object.assign(client, {
        signUpPolicy: vi.fn(async () => OPEN),
        me: vi.fn(async () => ({ orgs: [{ orgId: "org-2" }] })),
      });
      setup?.(client);
    });
    return { pk, ...l };
  }
  /** The sign-in card's buttons, top to bottom, by test id. */
  const order = () =>
    [...document.querySelectorAll<HTMLElement>("[data-testid=sign-in-btn], [data-testid=sign-up-btn]")].map(
      (b) => b.dataset.testid,
    );
  const forgetSessions = () => {
    for (const key of Object.keys(localStorage)) if (key.startsWith("calimero-session:")) localStorage.removeItem(key);
  };

  it("a sign-in offers only the passkeys that worked on this cluster", async () => {
    const first = await withPasskey([world("app-a", "alpha", "org-a")]);
    click(q("[data-testid=sign-in-btn]"));
    await until(listed);
    expect(first.pk.get.mock.calls[0]?.[2]).toBeUndefined();
    document.body.innerHTML = "";
    forgetSessions();

    const again = await withPasskey([world("app-a", "alpha", "org-a")]);
    click(q("[data-testid=sign-in-btn]"));
    await until(listed);
    expect(again.pk.get.mock.calls[0]?.[2]).toEqual(["cred-here"]);
  });

  it("says which passkeys work here", async () => {
    await withPasskey([]);
    expect(q("[data-testid=sign-in-hint]")?.textContent).toBe(SIGN_IN_HINT);
  });

  it("a sign-in the cluster has no account for switches to creating one, in place", async () => {
    invited("tok-1");
    localStorage.setItem(accountHintKey(resolveTarget(ENV)), "1");
    await withPasskey([], (c) =>
      c.signIn.mockRejectedValue(new CalimeroError(401, "PASSKEY_UNKNOWN_HERE", "unknown passkey")),
    );
    expect(order()).toEqual(["sign-in-btn", "sign-up-btn"]);
    click(q("[data-testid=sign-in-btn]"));
    await until(() => (q("[data-testid=signin-switched]") as HTMLElement | null)?.hidden === false);
    expect(q("[data-testid=signin-switched]")?.textContent).toBe(noAccountCopy("a world", true));
    expect(order()).toEqual(["sign-up-btn", "sign-in-btn"]);
    expect(q("[data-testid=sign-up-btn]")?.textContent).toBe("Create your account and join");
    expect(q("[data-testid=sign-in-error]")?.textContent).toBe("");
  });

  it("an invited person with no account here sees Create first; one who has signed in here sees Sign in first", async () => {
    invited("tok-1");
    await withPasskey([]);
    expect(order()).toEqual(["sign-up-btn", "sign-in-btn"]);
    document.body.innerHTML = "";
    localStorage.setItem(accountHintKey(resolveTarget(ENV)), "1");
    await withPasskey([]);
    expect(order()).toEqual(["sign-in-btn", "sign-up-btn"]);
  });

  it("a sign-up carries the invite on an open cluster, joins in that step and enters the world", async () => {
    invited("tok-1");
    const { client, choice } = await withPasskey([world("app-1", "mine", "org-1"), world("app-2", "theirs", "org-2")]);
    await flush();
    click(q("[data-testid=sign-up-btn]"));
    // Joined at sign-up: the world's org has no name for the player yet, asked once.
    await until(() => q("[data-testid=name-modal]") !== null);
    (q("[data-testid=name-modal] input") as HTMLInputElement).value = "Sam";
    click(q("[data-testid=name-save-btn]"));
    const entered = await choice;
    expect(entered.name).toBe("Sam");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Steve", { invite: "tok-1" });
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(entered.world.appId).toBe("app-2");
    expect(invites.token()).toBeNull();
  });

  it("a sign-up the node refuses for its invite drops the token and offers the account without it", async () => {
    invited("tok-dead");
    const { client } = await withPasskey([], (c) =>
      c.signUp.mockRejectedValueOnce(new SignUpRefused("sign-up refused: the invite has expired")),
    );
    await flush();
    click(q("[data-testid=sign-up-btn]"));
    await until(() => (q("[data-testid=sign-in-error]")?.textContent ?? "") !== "");
    expect(q("[data-testid=sign-in-error]")?.textContent).toBe(
      "That invite has expired or has no uses left: ask whoever sent it for a new one. You can still create your account without it.",
    );
    expect(invites.token()).toBeNull();
    expect(q("[data-testid=invite-note]")).toBeNull();
    expect(q("[data-testid=sign-up-btn]")?.textContent).not.toContain("join");
    // The next sign-up goes without it.
    click(q("[data-testid=sign-up-btn]"));
    await until(() => q("[data-testid=create-world-open-btn]") !== null);
    expect(client.signUp).toHaveBeenLastCalledWith(expect.anything(), "Steve");
  });
});
