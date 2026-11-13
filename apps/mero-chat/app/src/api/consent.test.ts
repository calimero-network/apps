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
});
