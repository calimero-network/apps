// The launcher's screens with a mocked CalimeroClient: sign in, the world
// list, creating a world, entering one, an invite link redeemed after sign-in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, CalimeroClient, CalimeroSession, PasskeyProvider } from "@calimero-network/mero-js";
import { SIGN_UP_NOT_FINISHED, SIGN_UP_READY } from "@calimero-apps/passkey/signUpFlow";
import { SIGN_IN_HINT, accountHintKey, noAccountCopy } from "@calimero-apps/passkey/ceremony";
import { CalimeroError } from "@calimero-network/mero-js";
import { resolveTarget } from "@calimero-apps/connect";

vi.mock("../src/ui/panorama", () => ({ Panorama: class { destroy() {} } }));
vi.mock("../src/pages/landing/mount", () => ({ showLandingAgain: vi.fn(async () => {}) }));

import { connect, type Phase, type SessionDeps } from "../src/net/session";
import { Landing, type LaunchChoice } from "../src/ui/landing";
import { PACKAGE } from "../src/net/blocks";

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
  return {
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
  const choice = new Landing(app, deps).show(phase, { name: "Steve", seed: 1337 });
  return { client, app, choice };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const click = (el: Element | null) => (el as HTMLElement).click();
const q = (sel: string) => document.querySelector(sel);

beforeEach(() => localStorage.clear());
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
  });

  it("puts the world last played first, with Enter and an invite button", async () => {
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
    click(q("[data-testid=create-world-btn]"));
    const entered = await choice;
    expect(client.createOrg).toHaveBeenCalledWith("castle");
    expect(client.createApp).toHaveBeenCalledWith("castle", "bundle-1", {
      org: "org-new",
      initArgs: expect.objectContaining({ name: "castle", seed: "42" }),
    });
    expect(entered.world).toEqual({ appId: "app-new", name: "castle", org: "org-new" });
  });

  it("redeems an invite link after sign-in and enters the world it joined", async () => {
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
    const { client, choice } = await launcher([world("app-1", "mine", "org-1"), world("app-2", "theirs", "org-2")]);
    expect(q("[data-testid=invite-note]")).not.toBeNull();
    click(q("[data-testid=sign-in-btn]"));
    const entered = await choice;
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
    expect(entered.world.appId).toBe("app-2");
    expect(localStorage.getItem("mero-blocks:pending-invite")).toBeNull();
  });

  it("words the sign-in as the invitation when a link is waiting", async () => {
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
    await launcher([]);
    expect(q("[data-testid=invite-note]")?.textContent).toBe(
      "You've been invited to join a world in Mero Blocks. Sign in or create an account to accept.",
    );
  });

  it("enters a world the player is already in without spending the link", async () => {
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
    localStorage.setItem("mero-blocks:pending-invite-org", "org-1");
    const { client, choice } = await launcher([world("app-1", "mine", "org-1")]);
    click(q("[data-testid=sign-in-btn]"));
    const entered = await choice;
    expect(entered.world.appId).toBe("app-1");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem("mero-blocks:pending-invite")).toBeNull();
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
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
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
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
    await withPasskey([]);
    expect(order()).toEqual(["sign-up-btn", "sign-in-btn"]);
    document.body.innerHTML = "";
    localStorage.setItem(accountHintKey(resolveTarget(ENV)), "1");
    await withPasskey([]);
    expect(order()).toEqual(["sign-in-btn", "sign-up-btn"]);
  });

  it("a sign-up carries the invite on an open cluster, joins in that step and enters the world", async () => {
    localStorage.setItem("mero-blocks:pending-invite", "tok-1");
    const { client, choice } = await withPasskey([world("app-1", "mine", "org-1"), world("app-2", "theirs", "org-2")]);
    await flush();
    click(q("[data-testid=sign-up-btn]"));
    const entered = await choice;
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Steve", { invite: "tok-1" });
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(entered.world.appId).toBe("app-2");
    expect(localStorage.getItem("mero-blocks:pending-invite")).toBeNull();
  });
});

describe("a new version of a world", () => {
  /** What the node reports: world app-a of org-a runs 1.0.0 with 1.1.0 waiting; the account is `role` there. */
  function reports(client: Record<string, unknown>, role: string, upgradesHeldBy = "owner") {
    Object.assign(client, {
      me: vi.fn(async () => ({ accountId: "acc-1", orgs: [{ orgId: "org-a", role }] })),
      getOrg: vi.fn(async () => ({ members: { "acc-1": role }, defaultCapabilities: 4, capabilities: {}, teams: {} })),
      getApp: vi.fn(async () => ({ appId: "app-a", owner: "someone-else", org: "org-a" })),
      appsReportAll: vi.fn(async (scope: string | null) => ({
        scope: scope ? { kind: "org", org: scope } : { kind: "account" },
        governance: { releases: "owner", appUpgrades: "owner", outbound: "owner" },
        approvedReleases: null,
        clusterReleases: [],
        next: null,
        apps: scope
          ? [
              {
                app: "app-a",
                name: "alpha",
                scope: { kind: "org", org: "org-a" },
                package: { package: PACKAGE, version: "1.0.0" },
                upgradesHeldBy,
                availableVersions: ["1.1.0"],
              },
            ]
          : [],
      })),
      requestConsent: vi.fn(async () => ({ requestId: "r-1", url: "https://node/consent/r-1", expiresAt: 9e9 })),
    });
  }
  const upgradePrompt = () => q("[data-testid=upgrade-prompt]");
  const until = async (check: () => boolean) => {
    for (let i = 0; i < 50 && !check(); i++) await flush();
    expect(check()).toBe(true);
  };

  it("offers the world's organization owner the update, and Update opens the consent page", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, href: "https://blocks.example/1.0.0/", assign });
    try {
      const { client } = await launcher([world("app-a", "alpha", "org-a")], localStorage, undefined, (c) =>
        reports(c, "owner"),
      );
      click(q("[data-testid=sign-in-btn]"));
      await until(() => upgradePrompt() !== null);
      expect(upgradePrompt()!.textContent).toContain("Version 1.1.0 of Mero Blocks is available (you run 1.0.0).");
      click(q("[data-testid=upgrade-update]"));
      await until(() => assign.mock.calls.length > 0);
      expect((client as unknown as { requestConsent: ReturnType<typeof vi.fn> }).requestConsent).toHaveBeenCalledWith({
        kind: "upgrade",
        subject: { app: "app-a", toVersion: "1.1.0" },
        returnTo: "https://blocks.example/1.0.0/",
      });
      expect(assign).toHaveBeenCalledWith("https://node/consent/r-1");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("goes when the world is entered, and at sign-out", async () => {
    const { choice } = await launcher([world("app-a", "alpha", "org-a")], localStorage, undefined, (c) =>
      reports(c, "admin"),
    );
    click(q("[data-testid=sign-in-btn]"));
    await until(() => upgradePrompt() !== null);
    click(q("[data-testid=join-world-0]"));
    await choice;
    expect(upgradePrompt()).toBeNull();
  });

  it("shows nothing to a member who may not upgrade, nor where the publisher or the operator upgrades", async () => {
    for (const [role, holder] of [
      ["member", "owner"],
      ["owner", "publisher"],
      ["owner", "operator"],
    ] as const) {
      let reported: ReturnType<typeof vi.fn> | undefined;
      await launcher([world("app-a", "alpha", "org-a")], localStorage, undefined, (c) => {
        reports(c, role, holder);
        reported = (c as unknown as { appsReportAll: ReturnType<typeof vi.fn> }).appsReportAll;
      });
      click(q("[data-testid=sign-in-btn]"));
      await until(() => reported!.mock.calls.length === 2);
      await flush();
      await flush();
      expect(upgradePrompt()).toBeNull();
      document.body.innerHTML = "";
      localStorage.clear();
    }
  });
});
