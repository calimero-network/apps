// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  OpenConsentOptions,
  PasskeyProvider,
} from "@calimero-network/mero-js";
import { ConsentNotStarted, forgetBoundApp } from "@calimero-apps/connect";

const handoff = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@calimero-apps/passkey", () => ({ confirmConsentHandoff: handoff }));

import { ORG_CONSENT_KEY, returnFromConsent } from "./orgConsent";
import { deleteSpace } from "./spaces";

const passkey = () => ({}) as PasskeyProvider;

/** A client whose session is bound to `app` (`null`: unbound), able to open the consent page. */
function client(app: string | null) {
  const c = {
    session: { accountId: "acct-me" },
    auth: { me: vi.fn(async () => ({ accountId: "acct-me", app })) },
    orgs: {
      delete: vi.fn(async (args: { org: string }, options?: unknown) => ({ args, options })),
    },
    openConsentPage: vi.fn(
      async (_request: unknown, options?: OpenConsentOptions) => {
        const started = {
          requestId: "req-1",
          url: "https://node.example/consent/req-1",
          code: "ABC-DEF",
        };
        await (
          options as
            { confirm?: (s: typeof started) => Promise<boolean> } | undefined
        )?.confirm?.(started);
        return started;
      },
    ),
  };
  forgetBoundApp(c);
  return c;
}

async function stillPending(p: Promise<unknown>): Promise<boolean> {
  const tag = Symbol("pending");
  return (
    (await Promise.race([
      p,
      new Promise((resolve) => setTimeout(() => resolve(tag), 20)),
    ])) === tag
  );
}

beforeEach(() => {
  sessionStorage.clear();
  handoff.mockResolvedValue(true);
});
afterEach(() => vi.clearAllMocks());

describe("deleting a space", () => {
  it("from the app's own frontend: on the consent page, never the refused direct call", async () => {
    const c = client("com.calimero.mero-forum");
    const done = deleteSpace(c as never, "org-1", passkey, "Acme");
    expect(await stillPending(done)).toBe(true);
    expect(c.openConsentPage.mock.calls[0]![0]).toMatchObject({
      kind: "deleteOrg",
      subject: { org: "org-1" },
    });
    expect(c.orgs.delete).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(ORG_CONSENT_KEY)!)).toEqual({
      kind: "deleteOrg",
      org: "org-1",
      name: "Acme",
    });
  });

  it("staying: nothing is kept or deleted", async () => {
    handoff.mockResolvedValue(false);
    const c = client("com.calimero.mero-forum");
    await expect(
      deleteSpace(c as never, "org-1", passkey, "Acme"),
    ).rejects.toBeInstanceOf(ConsentNotStarted);
    expect(sessionStorage.getItem(ORG_CONSENT_KEY)).toBeNull();
    expect(c.orgs.delete).not.toHaveBeenCalled();
  });

  it("an unbound session deletes it itself, as before", async () => {
    const c = client(null);
    await deleteSpace(c as never, "org-1", passkey, "Acme");
    expect(c.openConsentPage).not.toHaveBeenCalled();
    expect(c.orgs.delete.mock.calls[0]![0]).toEqual({ org: "org-1" });
  });
});

describe("back from the consent page", () => {
  const RETURN =
    "https://forum.apps.example/spaces?request_id=req-1&result=approved";

  it("reads the decision on the deletion this tab asked for", async () => {
    sessionStorage.setItem(
      ORG_CONSENT_KEY,
      JSON.stringify({ kind: "deleteOrg", org: "org-1", name: "Acme" }),
    );
    const resumeConsent = vi.fn(async () => ({
      requestId: "req-1",
      kind: "deleteOrg",
      status: "approved",
    }));
    expect(await returnFromConsent({ resumeConsent } as never, RETURN)).toEqual(
      {
        kind: "deleteOrg",
        approved: true,
        org: "org-1",
        name: "Acme",
      },
    );
    expect(sessionStorage.getItem(ORG_CONSENT_KEY)).toBeNull();
  });

  it("leaves a return it kept nothing for to the shared dialogs", async () => {
    const resumeConsent = vi.fn();
    expect(
      await returnFromConsent({ resumeConsent } as never, RETURN),
    ).toBeNull();
    expect(
      await returnFromConsent(
        { resumeConsent } as never,
        "https://forum.apps.example/spaces",
      ),
    ).toBeNull();
    expect(resumeConsent).not.toHaveBeenCalled();
  });
});
