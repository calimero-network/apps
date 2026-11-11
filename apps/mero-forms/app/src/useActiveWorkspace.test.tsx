/**
 * The open workspace is an app instance, served the frontend of the release
 * it runs (`useInstanceRelease`): on a page a node serves, a remembered
 * workspace that runs another release moves the page there; on its own
 * release, or in development, it stays. Runs on the real passkey session and
 * a mocked CalimeroClient.
 */
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, targetKey } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APP, type SessionDeps } from "./session";
import { SessionProvider, useMaybeSignedIn } from "./sessionContext";
import { useActiveWorkspace } from "./useActiveWorkspace";
import { withRoutes } from "@calimero-apps/connect/testing";

// `useInstanceRelease` as on a page a node serves from `release.href` (a
// release's `/{version}/`), going nowhere but `release.navigate`. With no
// `href` it reads this test's own location: development, where it never moves.
const release = vi.hoisted(() => ({ href: null as string | null, navigate: vi.fn() }));
vi.mock("@calimero-apps/passkey", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calimero-apps/passkey")>();
  return {
    ...actual,
    useInstanceRelease: (...[client, app]: Parameters<typeof actual.useInstanceRelease>) =>
      actual.useInstanceRelease(client, app, release.href ? { href: release.href, navigate: release.navigate } : {}),
  };
});

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;
const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

/** As the app mounts it: once signed in, when the remembered workspace is this account's. */
function WhenSignedIn({ children }: { children: ReactNode }) {
  return useMaybeSignedIn() ? <>{children}</> : null;
}
function OpenWorkspace() {
  const { active, leaving } = useActiveWorkspace();
  return <p data-testid="workspace">{leaving ? "leaving" : (active?.appId ?? "none")}</p>;
}

/** Signed in, with workspace `app-1` remembered, which runs `version`. */
function openWorkspace(version: string) {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
  localStorage.setItem(
    `mero-forms:active:${targetKey(resolveTarget(DEV_ENV))}:acct-me`,
    JSON.stringify({ appId: "app-1", org: "org-1" }),
  );
  let session: CalimeroSession | undefined;
  const client = withRoutes({
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Acme", role: "member" }] })),
    getApp: vi.fn(async () => ({ appId: "app-1", org: "org-1" })),
    appsReportAll: vi.fn(async () => ({ apps: [{ app: "app-1", package: { package: "com.calimero.forms", version } }] })),
  });
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => withRoutes(client),
    passkey: () => ({}) as never,
  };
  render(
    <SessionProvider deps={deps}>
      <WhenSignedIn>
        <OpenWorkspace />
      </WhenSignedIn>
    </SessionProvider>,
  );
  return client;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  release.href = null;
  release.navigate.mockClear();
});
afterEach(cleanup);

describe("the release the open workspace runs (useInstanceRelease)", () => {
  it("moves a served page to the frontend of the release the workspace runs, and says it is leaving", async () => {
    release.href = `${HOST}/1.2.0/#/forms`;
    openWorkspace("1.0.0");
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/app-1/#/forms`));
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("workspace").textContent).toBe("leaving"));
  });

  it("stays on a served page of the release the workspace runs", async () => {
    release.href = `${HOST}/1.2.0/`;
    const client = openWorkspace("1.2.0");
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith("org-1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace").textContent).toBe("app-1");
  });

  it("does nothing in development", async () => {
    const client = openWorkspace("1.0.0");
    expect((await screen.findByTestId("workspace")).textContent).toBe("app-1");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
