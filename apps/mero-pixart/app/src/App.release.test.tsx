/**
 * A project is an app instance, served the frontend of the release it runs
 * (`useInstanceRelease`): on a page a node serves, opening one that runs
 * another release moves the page there and shows nothing of the project; on
 * its own release, or in development, it stays. Runs the real App, router
 * and passkey session on a mocked CalimeroClient.
 */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// The editor is tested on its own; here it only shows whether it is open.
vi.mock("./pages/EditorPage", () => ({ default: () => <div data-testid="editor-page" /> }));

import App from "./App";
import { SessionProvider } from "./api/sessionContext";
import { APP, type SessionDeps } from "./api/session";
import { withRoutes } from "@calimero-apps/connect/testing";

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;
const SESSION: CalimeroSession = { accountId: "acct-me", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const SLOW = { timeout: 10_000 };

/** Signed in, on the page of project `proj-1`, which runs `version`. */
function openProject(version: string) {
  new SessionStore(APP, resolveTarget(DEV_ENV), localStorage).save(SESSION);
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
    me: vi.fn(async () => ({ accountId: "acct-me", orgs: [{ orgId: "org-1", name: "Studio", role: "owner" }] })),
    getOrg: vi.fn(async () => ({ members: { "acct-me": "owner" }, memberMetadata: {}, capabilities: {}, defaultCapabilities: 3 })),
    listApps: vi.fn(async () => []),
    view: vi.fn(async () => ({ index: 1, result: null })),
    events: vi.fn(async function* () {}),
    getApp: vi.fn(async () => ({ appId: "proj-1", org: "org-1" })),
    appsReportAll: vi.fn(async () => ({ apps: [{ app: "proj-1", package: { package: "com.calimero.pixart", version } }] })),
  });
  const deps: SessionDeps = {
    env: DEV_ENV,
    makeClient: async () => withRoutes(client),
    passkey: () => ({}) as never,
  };
  render(
    <SessionProvider deps={deps}>
      <MemoryRouter initialEntries={["/teams/org-1/projects/proj-1"]}>
        <App />
      </MemoryRouter>
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

describe("the release the open project runs (useInstanceRelease)", () => {
  it("moves a served page to the frontend of the release the project runs, and shows nothing of it meanwhile", async () => {
    release.href = `${HOST}/1.2.0/teams/org-1/projects/proj-1`;
    openProject("1.0.0");
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/proj-1/teams/org-1/projects/proj-1`), SLOW);
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("editor-page")).toBeNull(), SLOW);
  });

  it("stays on a served page of the release the project runs", async () => {
    release.href = `${HOST}/1.2.0/teams/org-1/projects/proj-1`;
    const client = openProject("1.2.0");
    expect(await screen.findByTestId("editor-page", {}, SLOW)).toBeTruthy();
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith("org-1"), SLOW);
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("editor-page")).toBeTruthy();
  });

  it("does nothing in development", async () => {
    const client = openProject("1.0.0");
    expect(await screen.findByTestId("editor-page", {}, SLOW)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
