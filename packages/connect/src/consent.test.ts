import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ORG_CAPABILITIES, type CalimeroClient, type ConsentStarted, type OpenConsentOptions, type PasskeyProvider } from "@calimero-network/mero-js";

import {
  APP_CONSENT_INTENT_KEY,
  ConsentNeededError,
  ConsentNotStarted,
  ManageInHomeError,
  appConsentIntent,
  boundApp,
  isFrontendBound,
  refusedOnFrontend,
  resumeAppConsent,
  setConsentDefaults,
  startAppConsent,
} from "./consent";
import { createAppTeam, inviteToApp, keepAppsApart, openAppTeam, openAppTeams, setMembersMayInvite } from "./appTeams";
import { acceptAppInvite, appInvite, createAppOrg, leaveApp, leaveOrg, removeFromApp } from "./orgApp";
import { orgsWithApp } from "./orgs";
import { orgCluster } from "./testing";

const PKG = "com.calimero.mero-crm";
const SOURCE = { package: PKG };
const passkey = {} as PasskeyProvider;
const RETURN = "https://crm.apps.example/1.0.0/";

const STARTED = { requestId: "req-1", url: "https://node.example/consent/req-1", code: "ABC-DEF" } as ConsentStarted;

/** `openConsentPage` as the client runs it: the node answers, `confirm` decides, the page is left. */
function consentPage(go = true) {
  return vi.fn(async (_request: unknown, options?: OpenConsentOptions | ((url: string) => void)) => {
    const o = typeof options === "function" ? { navigate: options } : (options ?? {});
    if (o.confirm && !(await o.confirm(STARTED))) return STARTED;
    if (!go) return STARTED;
    o.navigate?.(STARTED.url);
    return STARTED;
  });
}

/** A cluster whose session is bound to `app` (`null`: unbound), able to open the consent page. */
function boundCluster(app: string | null = PKG) {
  const cluster = orgCluster({ me: "me" });
  const raw = cluster.client as unknown as {
    auth: { me: () => Promise<unknown> };
    openConsentPage: ReturnType<typeof consentPage>;
  };
  const me = raw.auth.me;
  raw.auth.me = async () => ({ ...((await me()) as object), app });
  raw.openConsentPage = consentPage();
  return { ...cluster, open: raw.openConsentPage };
}

/** Whether `p` is still pending after the microtasks and a tick: the page is navigating. */
async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const tag = Symbol("pending");
  const r = await Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(tag), 20))]);
  return r === tag;
}

/** The request the consent page was asked for, and what was kept for the return. */
function asked(open: ReturnType<typeof consentPage>) {
  return { request: open.mock.calls.at(-1)?.[0], kept: appConsentIntent() };
}

beforeEach(() => {
  sessionStorage.clear();
  setConsentDefaults({ returnTo: RETURN, confirm: () => true });
});
afterEach(() => setConsentDefaults({}));

describe("whether a session is bound", () => {
  it("is bound when /auth/me names an app, and asks once per client and account", async () => {
    const me = vi.fn(async () => ({ app: PKG }));
    const session = { accountId: "me" };
    const client = { auth: { me }, session } as never;
    expect(await boundApp(client)).toBe(PKG);
    expect(await isFrontendBound(client)).toBe(true);
    expect(me).toHaveBeenCalledTimes(1);
    session.accountId = "bob";
    await boundApp(client);
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("is unbound without an app, without /auth/me, or when it fails (asked again then)", async () => {
    expect(await isFrontendBound({ auth: { me: async () => ({ app: null }) } } as never)).toBe(false);
    expect(await isFrontendBound({})).toBe(false);
    const me = vi.fn(async () => {
      throw new Error("signed out");
    });
    const client = { auth: { me } } as never;
    expect(await isFrontendBound(client)).toBe(false);
    expect(await isFrontendBound(client)).toBe(false);
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("takes the caller's answer over the node's", async () => {
    const me = vi.fn(async () => ({ app: PKG }));
    expect(await isFrontendBound({ auth: { me } } as never, false)).toBe(false);
    expect(me).not.toHaveBeenCalled();
  });

  it("tells the node's refusal of a frontend session", () => {
    const msg = "a session opened on an app's frontend can use that app only; do this on the cluster's own page";
    expect(refusedOnFrontend({ status: 403, message: `403 FORBIDDEN: ${msg}` })).toBe(true);
    expect(refusedOnFrontend({ status: 403, message: "not allowed" })).toBe(false);
    expect(refusedOnFrontend(null)).toBe(false);
  });
});

describe("startAppConsent / resumeAppConsent", () => {
  it("keeps the intent and asks for the request built from it", async () => {
    const open = consentPage();
    await startAppConsent({ openConsentPage: open } as never, { kind: "removeMember", org: "o", account: "bob" }, { data: { to: "/members" } });
    expect(open.mock.calls[0]?.[0]).toEqual({ kind: "removeMember", subject: { org: "o", account: "bob" }, returnTo: RETURN });
    expect(appConsentIntent()).toEqual({ kind: "removeMember", org: "o", account: "bob", data: { to: "/members" } });
  });

  it("builds setCapabilities for a team's default without an account", async () => {
    const open = consentPage();
    await startAppConsent({ openConsentPage: open } as never, { kind: "setCapabilities", org: "o", team: "t", capabilities: 5 });
    expect(open.mock.calls[0]?.[0]).toEqual({
      kind: "setCapabilities",
      subject: { org: "o", team: "t", capabilities: 5 },
      returnTo: RETURN,
    });
  });

  it("forgets the intent and says so when the person stays", async () => {
    const open = consentPage();
    await expect(
      startAppConsent({ openConsentPage: open } as never, { kind: "leaveOrg", org: "o" }, { confirm: () => false }),
    ).rejects.toBeInstanceOf(ConsentNotStarted);
    expect(sessionStorage.getItem(APP_CONSENT_INTENT_KEY)).toBeNull();
  });

  it("forgets the intent when the node refuses the request", async () => {
    const open = vi.fn(async () => {
      throw new Error("409");
    });
    await expect(startAppConsent({ openConsentPage: open } as never, { kind: "leaveOrg", org: "o" })).rejects.toThrow("409");
    expect(sessionStorage.getItem(APP_CONSENT_INTENT_KEY)).toBeNull();
  });

  const resuming = (result: unknown) => ({ resumeConsent: vi.fn(async () => result) }) as unknown as Pick<CalimeroClient, "resumeConsent">;

  it("answers null on a page the consent page did not open", async () => {
    expect(await resumeAppConsent(resuming(null))).toBeNull();
  });

  it("finishes createOrg from the sealed outcome, member defaults left for their own approval", async () => {
    sessionStorage.setItem(
      APP_CONSENT_INTENT_KEY,
      JSON.stringify({ kind: "createOrg", name: "Acme", source: SOURCE, capabilities: 7 }),
    );
    const back = await resumeAppConsent(
      resuming({ requestId: "req-1", kind: "createOrg", status: "approved", outcome: { orgId: "org-1", teamId: "team-1" } }),
    );
    expect(back?.kind).toBe("createOrg");
    if (back?.kind !== "createOrg") return;
    expect(back.approved).toBe(true);
    expect(back.intent?.name).toBe("Acme");
    expect(back.created?.orgId).toBe("org-1");
    expect(back.created?.teamId).toBe("team-1");
    const err = back.created?.capabilitiesError as ConsentNeededError;
    expect(err).toBeInstanceOf(ConsentNeededError);
    expect(err.intent).toEqual({ kind: "setCapabilities", org: "org-1", capabilities: 7 });
    expect(sessionStorage.getItem(APP_CONSENT_INTENT_KEY)).toBeNull();
  });

  it("answers a declined request as made nothing", async () => {
    sessionStorage.setItem(APP_CONSENT_INTENT_KEY, JSON.stringify({ kind: "createOrg", name: "Acme", source: null }));
    const back = await resumeAppConsent(resuming({ requestId: "r", kind: "createOrg", status: "declined" }));
    expect(back).toMatchObject({ kind: "createOrg", approved: false, created: null });
  });

  it("answers an invite's token with what was kept for it", async () => {
    sessionStorage.setItem(
      APP_CONSENT_INTENT_KEY,
      JSON.stringify({ kind: "createInvite", org: "o", role: "member", teams: ["t"], appTeams: ["t"], mode: "shared", appOnly: true }),
    );
    const back = await resumeAppConsent(
      resuming({ requestId: "r", kind: "createInvite", status: "approved", outcome: { token: "tok" } }),
    );
    expect(back).toMatchObject({
      kind: "createInvite",
      invite: { org: "o", token: "tok", appOnly: true, teams: ["t"], mode: "shared" },
    });
  });

  it("answers the org an accepted invite joined", async () => {
    const back = await resumeAppConsent(
      resuming({ requestId: "r", kind: "acceptInvite", status: "approved", outcome: { org: "o" } }),
    );
    expect(back).toMatchObject({ kind: "acceptInvite", org: "o", intent: null });
  });

  it("drops an intent kept for another kind", async () => {
    sessionStorage.setItem(APP_CONSENT_INTENT_KEY, JSON.stringify({ kind: "leaveOrg", org: "o" }));
    const back = await resumeAppConsent(resuming({ requestId: "r", kind: "removeMember", status: "approved" }));
    expect(back).toMatchObject({ kind: "removeMember", approved: true, intent: null });
  });
});

describe("createAppOrg", () => {
  it("bound: goes to the consent page's createOrg (the node makes the app team) and stays there", async () => {
    const c = boundCluster();
    const p = createAppOrg(c.client, "Acme", SOURCE, passkey, { capabilities: 7 });
    expect(await stillPending(p)).toBe(true);
    const { request, kept } = asked(c.open);
    expect(request).toEqual({ kind: "createOrg", subject: { name: "Acme" }, returnTo: RETURN });
    expect(kept).toEqual({ kind: "createOrg", name: "Acme", source: SOURCE, capabilities: 7 });
    expect(c.callsOf("createOrg")).toEqual([]);
    expect(c.callsOf("setCapabilities")).toEqual([]);
    expect(c.callsOf("scopeApps")).toEqual([]);
  });

  it("unbound: creates the org, its defaults and the app team itself", async () => {
    const c = boundCluster(null);
    const made = await createAppOrg(c.client, "Acme", SOURCE, passkey, { capabilities: 7 });
    expect(made.orgId).toBeTruthy();
    expect(made.teamId).toBeTruthy();
    expect(c.open).not.toHaveBeenCalled();
    expect(c.callsOf("createOrg")).toHaveLength(1);
    expect(c.callsOf("scopeApps")).toHaveLength(1);
  });

  it("bound and the person stays: nothing made, ConsentNotStarted", async () => {
    const c = boundCluster();
    await expect(
      createAppOrg(c.client, "Acme", SOURCE, passkey, { consent: { confirm: () => false } }),
    ).rejects.toBeInstanceOf(ConsentNotStarted);
    expect(c.callsOf("createOrg")).toEqual([]);
  });
});

describe("removing and leaving", () => {
  it("bound, legacy org: removeFromApp is the consent page's removeMember", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "legacy", members: { bob: "member" } });
    expect(await stillPending(removeFromApp(c.client, org, SOURCE, "bob", passkey))).toBe(true);
    expect(asked(c.open).request).toEqual({ kind: "removeMember", subject: { org, account: "bob" }, returnTo: RETURN });
    expect(c.callsOf("removeMember")).toEqual([]);
  });

  it("bound, standalone org: removing oneself is leaveOrg", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "standalone", app: PKG, role: "member", members: { boss: "owner" } });
    expect(await stillPending(removeFromApp(c.client, org, SOURCE, "me", passkey))).toBe(true);
    expect(asked(c.open).request).toEqual({ kind: "leaveOrg", subject: { org }, returnTo: RETURN });
  });

  it("bound, shared org: the app's own team, done here as before", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "shared", app: PKG, members: { bob: "member" }, appTeamRows: ["me", "bob"] });
    expect(await removeFromApp(c.client, org, SOURCE, "bob", passkey)).toBe("app");
    expect(c.callsOf("removeTeamMember")).toHaveLength(1);
    expect(c.open).not.toHaveBeenCalled();
  });

  it("unbound, legacy org: removeMember as before", async () => {
    const c = boundCluster(null);
    const org = c.addOrg({ mode: "legacy", members: { bob: "member" } });
    expect(await removeFromApp(c.client, org, SOURCE, "bob", passkey)).toBe("org");
    expect(c.callsOf("removeMember")).toHaveLength(1);
  });

  it("bound, legacy org: leaveApp is the consent page's leaveOrg", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "legacy", role: "member", members: { boss: "owner" } });
    expect(await stillPending(leaveApp(c.client, org, SOURCE, passkey))).toBe(true);
    expect(asked(c.open).request).toEqual({ kind: "leaveOrg", subject: { org }, returnTo: RETURN });
  });

  it("leaveOrg: the consent page when bound, removeMember when not", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "legacy", role: "member", members: { boss: "owner" } });
    expect(await stillPending(leaveOrg(c.client, org, passkey))).toBe(true);
    expect(asked(c.open).kept).toEqual({ kind: "leaveOrg", org });

    const u = boundCluster(null);
    const org2 = u.addOrg({ mode: "legacy", role: "member", members: { boss: "owner" } });
    await leaveOrg(u.client, org2, passkey);
    expect(u.callsOf("removeMember")).toHaveLength(1);
    expect(u.open).not.toHaveBeenCalled();
  });
});

describe("invites", () => {
  it("bound: appInvite names the app team on the consent page's createInvite", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "shared", app: PKG });
    const team = c.teamOf(org, PKG)!;
    expect(await stillPending(appInvite(c.client, org, SOURCE, passkey, { uses: 1 }))).toBe(true);
    const { request, kept } = asked(c.open);
    expect(request).toEqual({
      kind: "createInvite",
      subject: { org, role: "member", teams: [team], uses: 1 },
      returnTo: RETURN,
    });
    expect(kept).toMatchObject({ appTeams: [team], mode: "shared", appOnly: true });
    expect(c.callsOf("invite")).toEqual([]);
  });

  it("bound, raw bundle: an org-wide createInvite", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "legacy" });
    expect(await stillPending(appInvite(c.client, org, "bundle-hash", passkey))).toBe(true);
    expect(asked(c.open).request).toEqual({
      kind: "createInvite",
      subject: { org, role: "member", teams: [] },
      returnTo: RETURN,
    });
  });

  it("unbound: inviteToApp mints the token itself", async () => {
    const c = boundCluster(null);
    const org = c.addOrg({ mode: "standalone", app: PKG });
    const made = await inviteToApp(c.client, org, PKG, { passkey });
    expect(made.token).toBeTruthy();
    expect(c.open).not.toHaveBeenCalled();
  });

  it("acceptAppInvite: the consent page's acceptInvite when bound, redeemInvite when not", async () => {
    const open = consentPage();
    const inviteRedeem = vi.fn(async () => ({ org: "o" }));
    const bound = { orgs: { inviteRedeem }, openConsentPage: open };
    expect(await stillPending(acceptAppInvite(bound as never, "tok", { bound: true, org: "o" }))).toBe(true);
    expect(open.mock.calls[0]?.[0]).toEqual({ kind: "acceptInvite", subject: { token: "tok" }, returnTo: RETURN });
    expect(appConsentIntent()).toEqual({ kind: "acceptInvite", token: "tok", org: "o" });
    expect(inviteRedeem).not.toHaveBeenCalled();

    expect(await acceptAppInvite(bound as never, "tok", { bound: false })).toEqual({ org: "o", redeemed: { org: "o" } });
  });
});

describe("app teams", () => {
  it("setMembersMayInvite: the team's default on the consent page when bound", async () => {
    const open = consentPage();
    const capabilities = vi.fn(async () => ({}));
    const client = { orgs: { capabilities }, openConsentPage: open } as never;
    const team = { teamId: "t", defaultCapabilities: 1 };
    expect(await stillPending(setMembersMayInvite(client, "o", team, true, passkey, { bound: true }))).toBe(true);
    expect(open.mock.calls[0]?.[0]).toEqual({
      kind: "setCapabilities",
      subject: { org: "o", team: "t", capabilities: 1 | ORG_CAPABILITIES.INVITE_MEMBERS },
      returnTo: RETURN,
    });
    expect(capabilities).not.toHaveBeenCalled();

    expect(await setMembersMayInvite(client, "o", team, true, passkey, { bound: false })).toBe(1 | ORG_CAPABILITIES.INVITE_MEMBERS);
    expect(capabilities).toHaveBeenCalledTimes(1);
  });

  it("opening an app team, adding one or keeping apps apart is Calimero Home's when bound", async () => {
    const teamUpdate = vi.fn(async () => ({}));
    const appTeamsScope = vi.fn(async () => ({ mode: "shared", teams: [] }));
    const me = async () => ({ app: PKG });
    const client = { auth: { me }, orgs: { teamUpdate, appTeamsScope } } as never;
    await expect(openAppTeam(client, "o", { teamId: "t" })).rejects.toBeInstanceOf(ManageInHomeError);
    await expect(openAppTeams(client, "o", [{ teamId: "t", join: "invite" }])).rejects.toBeInstanceOf(ManageInHomeError);
    await expect(createAppTeam(client, "o", PKG, passkey)).rejects.toBeInstanceOf(ManageInHomeError);
    await expect(keepAppsApart(client, "o", passkey)).rejects.toThrow(/Calimero Home/);
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(appTeamsScope).not.toHaveBeenCalled();

    await openAppTeam({ orgs: { teamUpdate } } as never, "o", { teamId: "t" });
    expect(teamUpdate).toHaveBeenCalledWith({ org: "o", team: "t", join: "everyone" });
  });
});

describe("orgsWithApp", () => {
  it("lists an org made on the consent page by its app team (it cannot be marked from a frontend)", async () => {
    const c = boundCluster();
    const org = c.addOrg({ mode: "standalone", app: PKG });
    c.addOrg({ mode: "standalone", app: "com.calimero.other" });
    const listed = await orgsWithApp(c.client, SOURCE, { marked: true });
    expect(listed.map((o) => o.orgId)).toEqual([org]);
  });
});
