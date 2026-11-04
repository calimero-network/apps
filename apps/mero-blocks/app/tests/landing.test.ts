// The launcher's screens with a mocked CalimeroClient: sign in, the world
// list, creating a world, entering one, an invite link redeemed after sign-in.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo, CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";

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

async function launcher(worlds: AppInfo[], storage = localStorage) {
  const client = fakeClient(worlds);
  const deps: SessionDeps = {
    env: ENV,
    storage,
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as never,
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
