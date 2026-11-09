import { describe, expect, it, vi } from "vitest";
import {
  CalimeroError,
  LoginRequired,
  QuotaExceeded,
  SignUpRefused,
  UnavailableError,
} from "@calimero-network/mero-js";

import {
  canCreateIn,
  createInviteStore,
  describeRedeemFailure,
  inviteLink,
  inviteRefusal,
  isSpentInvite,
  joinedOrg,
  mayCreateIn,
  memberOf,
  SPENT_INVITE_COPY,
} from "./invite";
import type { KeyValueStorage } from "./client";
import type { Target } from "./target";

function memoryStorage(seed: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const EU: Target = { kind: "cloud", cluster: "eu-shared-1", minReleaseVersion: "1.0.0" };
const US: Target = { kind: "cloud", cluster: "us-shared-1", minReleaseVersion: "1.0.0" };

function history() {
  return { replaceState: vi.fn() };
}

/** What `redeemInvite` and `signUp` answer, as mero-js builds it from the node's reply. */
function rejected(message: string, status = 400, code = "REJECTED"): CalimeroError {
  return new CalimeroError(status, code, message);
}

describe("inviteRefusal / isSpentInvite: only the node's word that the invite is done", () => {
  it.each([
    ["sign-up, unknown (core before rc.12)", new SignUpRefused("sign-up refused: unknown invite"), "unknown-invite"],
    [
      "sign-up, used up (core rc.12, which mero-js 29.7.7 reads as 'other')",
      new SignUpRefused("sign-up refused: this invite was used up, revoked or never existed"),
      "unknown-invite",
    ],
    ["sign-up, expired", new SignUpRefused("sign-up refused: the invite has expired"), "expired-invite"],
    ["sign-up, org gone", new SignUpRefused("sign-up refused: the invite's organization is gone"), "org-gone"],
    ["redeem, unknown", rejected("unknown invite"), "unknown-invite"],
    ["redeem, used up", rejected("this invite was used up, revoked or never existed"), "unknown-invite"],
    ["redeem, expired (old)", rejected("invite expired"), "expired-invite"],
    ["redeem, expired", rejected("this invite has expired"), "expired-invite"],
    ["redeem, org gone", rejected("no such organization"), "org-gone"],
  ])("%s", (_, error, reason) => {
    expect(inviteRefusal(error)).toBe(reason);
    expect(isSpentInvite(error)).toBe(true);
  });

  it.each([
    ["401: the session lapsed", new LoginRequired("session expired")],
    ["429: slow down", new QuotaExceeded("quota exceeded: requests")],
    ["429 with an invite word in it", new CalimeroError(429, "RATE_LIMITED", "too many invite redemptions")],
    ["408", new CalimeroError(408, "TIMEOUT", "unknown invite")],
    ["503", new UnavailableError("UNAVAILABLE", "no leader")],
    ["500", new CalimeroError(500, "INTERNAL", "unknown invite")],
    ["a network failure", new TypeError("Failed to fetch")],
    ["a plain error that mentions expiry", new Error("invite expired")],
    ["the cluster's policy, not the invite", new SignUpRefused("sign-up refused: this cluster takes new accounts by invite only")],
    ["closed cluster", new SignUpRefused("sign-up refused: this cluster takes only accounts its operator or owner pre-authorized with a sign-up invite")],
    ["another 400", rejected("that redemption was used already")],
  ])("keeps the token on %s", (_, error) => {
    expect(inviteRefusal(error)).toBeNull();
    expect(isSpentInvite(error)).toBe(false);
  });

  it("says a spent invite plainly and anything else as worth retrying, the token kept", () => {
    expect(describeRedeemFailure(rejected("this invite has expired"))).toBe(SPENT_INVITE_COPY);
    expect(describeRedeemFailure(new LoginRequired("session expired"))).toMatch(/sign in again.*invite is kept/i);
    expect(describeRedeemFailure(new QuotaExceeded("slow down"))).toMatch(/wait a moment.*invite is kept/i);
    expect(describeRedeemFailure(new TypeError("Failed to fetch"))).toMatch(/Failed to fetch.*try again.*invite is kept/i);
  });
});

describe("inviteLink: at the root, never pinned to the inviter's frontend version", () => {
  it("puts the token and where it points in the query of the origin's root", () => {
    const link = inviteLink("tok 1", {
      origin: "https://abc.apps.calimero.network",
      org: "org-1",
      team: "team-1",
      doc: "doc-1",
      route: "/forums/42",
      extra: { forum: "f-9", empty: null },
    });
    const url = new URL(link);
    expect(url.origin + url.pathname).toBe("https://abc.apps.calimero.network/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      invite: "tok 1",
      org: "org-1",
      team: "team-1",
      doc: "doc-1",
      to: "/forums/42",
      forum: "f-9",
    });
  });

  it("leaves out what the link does not name, and a front-door route", () => {
    expect(inviteLink("t", { origin: "http://localhost:5173", route: "/" })).toBe("http://localhost:5173/?invite=t");
  });

  it("can still be pinned to a base for a cluster that drops the query on its redirect", () => {
    expect(inviteLink("t", { origin: "https://x.example", root: "/1.2.0/" })).toBe("https://x.example/1.2.0/?invite=t");
  });
});

describe("createInviteStore", () => {
  it("captures a root link once: stored, the address bar cleaned, subscribers told", () => {
    const storage = memoryStorage();
    const h = history();
    const store = createInviteStore("crm", { storage, keep: ["forum"] });
    const heard = vi.fn();
    store.subscribe(heard);

    const got = store.capture(
      { href: "https://abc.apps.calimero.network/1.2.0/?invite=tok&org=o&team=t&doc=d&to=%2Fforums%2F42&forum=f&utm=x#h" },
      { basename: "/1.2.0/", history: h },
    );
    const expected = { token: "tok", org: "o", team: "t", doc: "d", route: "/forums/42", extra: { forum: "f" } };
    expect(got).toEqual(expected);
    expect(store.pending()).toEqual(expected);
    expect(store.token()).toBe("tok");
    expect(heard).toHaveBeenCalled();
    expect(h.replaceState).toHaveBeenCalledWith(null, "", "https://abc.apps.calimero.network/1.2.0/?utm=x#h");
    // The same object while nothing changed (useSyncExternalStore).
    expect(store.pending()).toBe(store.pending());
  });

  it("reads a version-pinned link's route from its path, relative to the basename", () => {
    const store = createInviteStore("crm", { storage: memoryStorage() });
    store.capture(
      { href: "https://abc.apps.calimero.network/1.1.0/deals/7?invite=tok&org=o" },
      { basename: "/1.1.0/", history: history() },
    );
    expect(store.pending()).toMatchObject({ token: "tok", org: "o", route: "/deals/7" });

    store.capture({ href: "https://abc.apps.calimero.network/1.1.0/?invite=tok2" }, { basename: "/1.1.0", history: history() });
    expect(store.pending()).toMatchObject({ token: "tok2", org: null, route: null });
  });

  it("never takes a route that leaves the app", () => {
    const store = createInviteStore("crm", { storage: memoryStorage() });
    for (const to of ["//evil.example/x", "https://evil.example/", "/\\evil.example", "javascript:alert(1)"]) {
      store.capture({ href: `https://a.example/?invite=t&to=${encodeURIComponent(to)}` }, { history: history() });
      expect(store.pending()?.route).toBeNull();
    }
  });

  it("does nothing without a token, and keeps the address bar when storage refuses the write", () => {
    const h = history();
    const store = createInviteStore("crm", { storage: memoryStorage() });
    expect(store.capture({ href: "https://a.example/?org=o" }, { history: h })).toBeNull();
    expect(h.replaceState).not.toHaveBeenCalled();

    const full: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const blocked = createInviteStore("crm", { storage: full });
    expect(blocked.capture({ href: "https://a.example/?invite=t" }, { history: h })).toMatchObject({ token: "t" });
    // Still usable on this page, and the link still holds it for a reload.
    expect(blocked.token()).toBe("t");
    expect(h.replaceState).not.toHaveBeenCalled();
  });

  it("is kept per cluster once bound: another cluster's session does not see it", () => {
    const storage = memoryStorage();
    const eu = createInviteStore("crm", { storage });
    eu.capture({ href: "https://a.example/?invite=t" }, { history: history() });
    eu.bind(EU);
    expect(eu.token()).toBe("t");

    const us = createInviteStore("crm", { storage });
    us.bind(US);
    expect(us.token()).toBeNull();

    const euAgain = createInviteStore("crm", { storage });
    euAgain.bind(EU);
    expect(euAgain.token()).toBe("t");
  });

  it("a link opened on this load replaces the one bound before", () => {
    const storage = memoryStorage();
    const first = createInviteStore("crm", { storage });
    first.capture({ href: "https://a.example/?invite=old" }, { history: history() });
    first.bind(EU);

    const next = createInviteStore("crm", { storage });
    next.capture({ href: "https://a.example/?invite=new" }, { history: history() });
    next.bind(EU);
    expect(next.token()).toBe("new");
  });

  it("drop forgets it everywhere and tells subscribers; unsubscribe stops that", () => {
    const store = createInviteStore("crm", { storage: memoryStorage() });
    store.capture({ href: "https://a.example/?invite=t" }, { history: history() });
    const heard = vi.fn();
    const off = store.subscribe(heard);
    store.drop();
    expect(store.pending()).toBeNull();
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    store.put({ token: "x", org: null, team: null, doc: null, route: null, extra: {} });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(store.token()).toBe("x");
  });

  it("is dropped on sign-out, and on a sign-in by another account than the one it was held for", () => {
    const store = createInviteStore("crm", { storage: memoryStorage() });
    store.capture({ href: "https://a.example/?invite=t" }, { history: history() });
    store.signedIn("acct-a");
    store.signedIn("acct-a");
    expect(store.token()).toBe("t");
    store.signedIn("acct-b");
    expect(store.token()).toBeNull();

    store.capture({ href: "https://a.example/?invite=t2" }, { history: history() });
    store.signedOut();
    expect(store.token()).toBeNull();
  });

  it("ignores a stored value it cannot read", () => {
    const storage = memoryStorage({ "calimero-invite:crm": "{not json" });
    expect(createInviteStore("crm", { storage }).pending()).toBeNull();
    storage.map.set("calimero-invite:crm", JSON.stringify({ token: 5 }));
    expect(createInviteStore("crm", { storage }).pending()).toBeNull();
  });
});

describe("memberOf / joinedOrg", () => {
  it("answers membership from the account's orgs, null when it cannot tell", async () => {
    const me = vi.fn(async () => ({ orgs: [{ orgId: "o1" }] }));
    expect(await memberOf({ me } as never, "o1")).toBe(true);
    expect(await memberOf({ me } as never, "o2")).toBe(false);
    expect(await memberOf({ me: async () => Promise.reject(new TypeError("offline")) } as never, "o1")).toBeNull();
  });

  it("reads the org a redemption joined, whichever field the node used", () => {
    expect(joinedOrg({ org: "o1" })).toBe("o1");
    expect(joinedOrg({ orgId: "o2" })).toBe("o2");
    expect(joinedOrg({})).toBeNull();
    expect(joinedOrg(null)).toBeNull();
  });
});

describe("mayCreateIn / canCreateIn: CREATE_APP the way core's Org::may decides it", () => {
  const org = {
    members: { owner: "owner", admin: "admin", member: "member", granted: "member", guest: "guest", lead: "member" },
    defaultCapabilities: 1 << 2,
    capabilities: { granted: 1 << 0 },
    teams: {
      top: { parent: null, members: { lead: true, member: false }, capabilities: {} },
      sub: { parent: "top", members: { member: false }, capabilities: { member: 1 << 0 } },
      other: { parent: null, members: { member: false }, capabilities: { granted: 0 } },
    },
  };

  it.each([
    ["the owner", "owner", null, true],
    ["an admin", "admin", "other", true],
    ["a plain member: not by default", "member", null, false],
    ["a member granted it org-wide", "granted", null, true],
    ["a guest, even granted", "guest", null, false],
    ["a non-member", "stranger", null, false],
    ["a team's lead, on that team", "lead", "top", true],
    ["a team's lead, on a team below it", "lead", "sub", true],
    ["a team's lead, org-wide", "lead", null, false],
    ["a member granted it on one team", "member", "sub", true],
    ["a member on a team where nothing is set: the org's grant", "granted", "top", true],
    ["a member whose team row withholds it", "granted", "other", false],
  ])("%s", (_, account, team, may) => {
    expect(mayCreateIn(org, account, team)).toBe(may);
  });

  it("a member holds the cluster's default when the org says none", () => {
    expect(mayCreateIn({ members: { m: "member" } }, "m")).toBe(false);
  });

  it("asks the node for the org as the signed-in account; null when it cannot tell", async () => {
    const getOrg = vi.fn(async () => org);
    expect(await canCreateIn({ getOrg, session: { accountId: "granted" } } as never, "o")).toBe(true);
    expect(getOrg).toHaveBeenCalledWith("o");
    expect(await canCreateIn({ getOrg, session: { accountId: "member" } } as never, "o", "sub")).toBe(true);
    expect(await canCreateIn({ getOrg, session: { accountId: "member" } } as never, "o")).toBe(false);
    expect(await canCreateIn({ getOrg, session: null } as never, "o")).toBeNull();
    expect(
      await canCreateIn({ getOrg: async () => Promise.reject(new TypeError("offline")), session: { accountId: "m" } } as never, "o"),
    ).toBeNull();
  });
});
