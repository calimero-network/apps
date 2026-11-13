import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  me: vi.fn(),
  openConsentPage: vi.fn(),
  resumeConsent: vi.fn(),
}));

vi.mock("./platform", () => ({
  run: (fn: (c: unknown) => Promise<unknown>) =>
    fn({ auth: { me: h.me }, openConsentPage: h.openConsentPage, resumeConsent: h.resumeConsent }),
}));
vi.mock("../utils/servedByNode", () => ({ nodeBasename: () => "/1.0.0/" }));

import {
  askOnConsentPage,
  consentIntent,
  consentRequest,
  CONSENT_INTENT_KEY,
  refusedOnFrontend,
  returnFromConsent,
} from "./consent";

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("Chat's consent page", () => {
  it("asks the node for what a frontend session may not do, returning to Chat's own root", () => {
    const returnTo = `${window.location.origin}/1.0.0/`;
    expect(consentRequest({ kind: "createOrg", name: "Acme", selfName: "Ann" })).toEqual({
      kind: "createOrg",
      subject: { name: "Acme" },
      returnTo,
    });
    expect(consentRequest({ kind: "createInvite", org: "org-1" }, { inviteTeams: ["team-chat"] })).toEqual({
      kind: "createInvite",
      subject: { org: "org-1", role: "member", teams: ["team-chat"] },
      returnTo,
    });
    expect(consentRequest({ kind: "acceptInvite", org: null }, { inviteToken: "tok" })).toEqual({
      kind: "acceptInvite",
      subject: { token: "tok" },
      returnTo,
    });
  });

  it("asks for the organization-wide changes in core's kinds and fields", () => {
    const returnTo = `${window.location.origin}/1.0.0/`;
    expect(consentRequest({ kind: "setMemberRole", org: "o", account: "a", role: "admin" })).toEqual({
      kind: "setMemberRole",
      subject: { org: "o", account: "a", role: "admin" },
      returnTo,
    });
    expect(consentRequest({ kind: "removeMember", org: "o", account: "a" })).toEqual({
      kind: "removeMember",
      subject: { org: "o", account: "a" },
      returnTo,
    });
    expect(consentRequest({ kind: "leaveOrg", org: "o" })).toEqual({ kind: "leaveOrg", subject: { org: "o" }, returnTo });
    expect(consentRequest({ kind: "renameOrg", org: "o", name: "Acme" })).toEqual({
      kind: "renameOrg",
      subject: { org: "o", name: "Acme" },
      returnTo,
    });
    expect(consentRequest({ kind: "deleteOrg", org: "o" })).toEqual({ kind: "deleteOrg", subject: { org: "o" }, returnTo });
  });

  it("tells the node's refusal of a frontend session from any other", () => {
    const refusal = {
      status: 403,
      code: "FORBIDDEN",
      message: "a session opened on an app's frontend can use that app only; do this on the cluster's own page",
    };
    expect(refusedOnFrontend(refusal)).toBe(true);
    expect(refusedOnFrontend({ status: 403, code: "FORBIDDEN", message: "not a member" })).toBe(false);
    expect(refusedOnFrontend({ status: 404, message: "an app's frontend" })).toBe(false);
    expect(refusedOnFrontend(null)).toBe(false);
  });

  it("keeps what Chat was doing, shows the page's code first, and forgets it when the person stays", async () => {
    const intent = { kind: "createOrg" as const, name: "Acme", selfName: "Ann" };
    h.openConsentPage.mockImplementation(async (_req, opts: { confirm: (s: { code: string }) => boolean }) => {
      expect(consentIntent()).toEqual(intent);
      opts.confirm({ code: "ABC-DEF" });
      return { requestId: "r1" };
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await expect(askOnConsentPage(intent, consentRequest(intent))).resolves.toBe(false);
    expect(confirm.mock.calls[0]?.[0]).toContain("ABC-DEF");
    expect(sessionStorage.getItem(CONSENT_INTENT_KEY)).toBeNull();
  });

  it("forgets the intent when the node refuses the request", async () => {
    h.openConsentPage.mockRejectedValue(new Error("refused"));
    await expect(
      askOnConsentPage({ kind: "createInvite", org: "org-1" }, consentRequest({ kind: "createInvite", org: "org-1" })),
    ).rejects.toThrow("refused");
    expect(consentIntent()).toBeNull();
  });

  it("on return, answers the node's decision with the intent kept for that kind, and forgets it", async () => {
    sessionStorage.setItem(CONSENT_INTENT_KEY, JSON.stringify({ kind: "createOrg", name: "Acme", selfName: "Ann" }));
    const result = { requestId: "r1", kind: "createOrg", status: "approved", decidedAt: 1, outcome: { orgId: "org-9" } };
    h.resumeConsent.mockResolvedValue(result);
    await expect(returnFromConsent()).resolves.toEqual({
      intent: { kind: "createOrg", name: "Acme", selfName: "Ann" },
      result,
    });
    expect(consentIntent()).toBeNull();

    // An intent kept for another kind is not this request's.
    sessionStorage.setItem(CONSENT_INTENT_KEY, JSON.stringify({ kind: "createInvite", org: "org-1" }));
    h.resumeConsent.mockResolvedValue({ ...result, kind: "acceptInvite", outcome: { org: "org-2" } });
    expect((await returnFromConsent())?.intent).toBeNull();

    h.resumeConsent.mockResolvedValue(null);
    await expect(returnFromConsent()).resolves.toBeNull();
  });

  it("keeps an organization kind's intent for its return", async () => {
    sessionStorage.setItem(CONSENT_INTENT_KEY, JSON.stringify({ kind: "renameOrg", org: "o", name: "Acme" }));
    const result = {
      requestId: "r1",
      kind: "renameOrg",
      status: "approved",
      decidedAt: 1,
      outcome: { orgId: "o", name: "Acme" },
    };
    h.resumeConsent.mockResolvedValue(result);
    await expect(returnFromConsent()).resolves.toEqual({ intent: { kind: "renameOrg", org: "o", name: "Acme" }, result });
  });
});

describe("askOrgConsent", () => {
  // `frontendBound` is asked once per load: a fresh module per case.
  async function load() {
    vi.resetModules();
    return import("./consent");
  }

  it("unbound: answers false and leaves the change to the caller", async () => {
    h.me.mockResolvedValue({ accountId: "acct-me" });
    const { askOrgConsent } = await load();
    await expect(askOrgConsent({ kind: "deleteOrg", org: "o" })).resolves.toBe(false);
    expect(h.openConsentPage).not.toHaveBeenCalled();
  });

  it("bound: sends the person to the consent page with the change's kind, keeping the intent", async () => {
    h.me.mockResolvedValue({ accountId: "acct-me", app: "chat" });
    h.openConsentPage.mockImplementation(async (_req, opts: { confirm: (s: { code: string }) => boolean }) => {
      opts.confirm({ code: "ABC-DEF" });
      return { requestId: "r1" };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { askOrgConsent, consentIntent: kept } = await load();
    void askOrgConsent({ kind: "leaveOrg", org: "o" });
    await vi.waitFor(() => expect(h.openConsentPage).toHaveBeenCalled());
    expect(h.openConsentPage.mock.calls[0]?.[0]).toMatchObject({ kind: "leaveOrg", subject: { org: "o" } });
    expect(kept()).toEqual({ kind: "leaveOrg", org: "o" });
  });

  it("bound, and the person stays: nothing was changed, and says so", async () => {
    h.me.mockResolvedValue({ accountId: "acct-me", app: "chat" });
    h.openConsentPage.mockImplementation(async (_req, opts: { confirm: (s: { code: string }) => boolean }) => {
      opts.confirm({ code: "ABC-DEF" });
      return { requestId: "r1" };
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const { askOrgConsent, StayedOnChat } = await load();
    await expect(askOrgConsent({ kind: "renameOrg", org: "o", name: "Acme" })).rejects.toBeInstanceOf(StayedOnChat);
    expect(consentIntent()).toBeNull();
  });
});
