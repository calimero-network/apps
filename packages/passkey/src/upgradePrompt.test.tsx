// The prompt as every app on the shared session gets it: `usePasskeySession`
// mounts it once a session is signed in, with no code in the app.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { KeyValueStorage } from "@calimero-apps/connect";

import { usePasskeySession, type SessionDeps } from "./session";

const PKG = "com.calimero.kv";

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** A client whose account is `role` in org-1, where one instance of the package has 1.2.0 waiting. */
function fakeClient(role: string, upgradesHeldBy = "owner") {
  const client = {
    session: null as null | { accountId: string },
    signIn: vi.fn(async () => (client.session = { accountId: "acct-me" })),
    signOut: vi.fn(async () => void (client.session = null)),
    useSession: vi.fn(),
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", role }] })),
    getOrg: vi.fn(async () => ({ members: { "acct-me": role }, defaultCapabilities: 4, capabilities: {}, teams: {} })),
    getApp: vi.fn(async () => ({ appId: "app-1", owner: "acct-boss", org: "org-1" })),
    appsReportAll: vi.fn(async (scope: string | null) => ({
      scope: scope ? { kind: "org", org: scope } : { kind: "account" },
      governance: { releases: "owner", appUpgrades: "owner", outbound: "owner" },
      approvedReleases: null,
      clusterReleases: [],
      next: null,
      apps: scope
        ? [
            {
              app: "app-1",
              name: "Team store",
              scope: { kind: "org", org: scope },
              package: { package: PKG, version: "1.0.0" },
              upgradesHeldBy,
              availableVersions: ["1.2.0"],
            },
          ]
        : [],
    })),
    requestConsent: vi.fn(),
    consentResult: vi.fn(),
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: { DEV: true },
    makeClient: async () => client as unknown as CalimeroClient,
    passkey: () => ({}) as PasskeyProvider,
    storage: memoryStorage(),
  };
}

const prompt = () => document.querySelector("[data-testid=upgrade-prompt]");
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the shared session's upgrade prompt", () => {
  it("appears for an organization's owner once signed in, and goes at sign-out", async () => {
    const client = fakeClient("owner");
    const d = deps(client);
    const { result, unmount } = renderHook(() => usePasskeySession("kv", d, { package: PKG, appName: "KV Store" }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    expect(prompt()).toBeNull();
    await act(() => result.current.signIn());
    await waitFor(() => expect(prompt()).not.toBeNull());
    expect(prompt()!.textContent).toContain("Version 1.2.0 of KV Store is available (you run 1.0.0).");
    expect(client.appsReportAll).toHaveBeenCalledTimes(2); // the account's own apps, and org-1's: once
    await act(() => result.current.signOut());
    expect(prompt()).toBeNull();
    unmount();
  });

  it("is never shown to a member who may not upgrade", async () => {
    const client = fakeClient("member");
    const d = deps(client);
    const { result, unmount } = renderHook(() => usePasskeySession("kv", d, { package: PKG, appName: "KV Store" }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signIn());
    await waitFor(() => expect(client.getApp).toHaveBeenCalled());
    await flush();
    expect(prompt()).toBeNull();
    unmount();
  });

  it("is not shown for an upgrade the publisher holds, nor the operator", async () => {
    for (const holder of ["publisher", "operator"]) {
      const client = fakeClient("owner", holder);
      const d = deps(client);
      const { result, unmount } = renderHook(() => usePasskeySession("kv", d, { package: PKG, appName: "KV Store" }));
      await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
      await act(() => result.current.signIn());
      await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledTimes(2));
      await flush();
      expect(prompt()).toBeNull();
      unmount();
    }
  });

  it("an app can turn it off", async () => {
    const client = fakeClient("owner");
    const d = deps(client);
    const { result, unmount } = renderHook(() => usePasskeySession("kv", d, { package: PKG, upgradePrompt: false }));
    await waitFor(() => expect(result.current.session.status).toBe("signed-out"));
    await act(() => result.current.signIn());
    await flush();
    expect(client.me).not.toHaveBeenCalled();
    expect(prompt()).toBeNull();
    unmount();
  });
});
