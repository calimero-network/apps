import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AppInfo, CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget } from "@calimero-apps/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { captureInvite } from "./api/teams";
import { APP } from "./session";
import type { SessionDeps } from "./session";

// The landing page is generated and tested on its own; here it is the door.
vi.mock("./pages/landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect
    </button>
  ),
}));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

const PROJECT: AppInfo = {
  appId: "app-1",
  name: "Poster",
  owner: ME,
  org: "org-1",
  bundle: "bundle-hash",
  package: null,
  version: null,
};

const DOC = {
  name: "Launch poster",
  description: "",
  width: 1920,
  height: 1080,
  background: "#00000000",
  layerCount: 3,
  memberCount: 2,
  owner: ME,
};

function fakeClient() {
  let session: CalimeroSession | undefined;
  return {
    get session() {
      return session;
    },
    useSession: vi.fn((s: CalimeroSession) => {
      session = s;
    }),
    signIn: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signUp: vi.fn(async () => {
      session = SESSION;
      return SESSION;
    }),
    signOut: vi.fn(async () => {
      session = undefined;
    }),
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Studio", role: "owner" }] })),
    getOrg: vi.fn(async () => ({
      name: "Studio",
      members: { [ME]: "owner", "acct-bob": "member" },
      memberMetadata: { "acct-bob": { name: "Bob" } },
    })),
    listApps: vi.fn(async () => [PROJECT]),
    createApp: vi.fn(async () => "app-2"),
    createOrg: vi.fn(async () => "org-2"),
    setCapabilities: vi.fn(async () => undefined),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result: method === "getDocument" ? DOC : null,
    })),
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({ org: "org-1" })),
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** A session an earlier visit left behind. */
function remember() {
  const store = new SessionStore(APP, resolveTarget(DEV_ENV));
  store.sync({ session: SESSION } as unknown as CalimeroClient);
}

describe("signing in", () => {
  it("opens the passkey dialog from the landing page and lands on your teams", async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText("Connect"));
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    expect(await screen.findByTestId("team-card-org-1")).toHaveTextContent("Studio");
  });

  it("creates an account with a name and a new passkey", async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText("Connect"));
    fireEvent.change(await screen.findByTestId("signup-name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "Alice"));
  });
});

describe("teams and projects", () => {
  it("lists a team's projects with the document's own name and size", async () => {
    remember();
    window.history.replaceState(null, "", "/teams/org-1/projects");
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    const card = await screen.findByTestId("project-card-app-1");
    await waitFor(() => expect(card).toHaveTextContent("Launch poster"));
    expect(card).toHaveTextContent("1920 × 1080");
    expect(card).toHaveTextContent("2 members");
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });
    expect(client.view).toHaveBeenCalledWith("app-1", "getDocument", {});
  });

  it("creates a project as an app instance in the team, then sets its document", async () => {
    remember();
    window.history.replaceState(null, "", "/teams/org-1/projects");
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("open-create-modal"));
    fireEvent.change(screen.getByTestId("new-project-input"), { target: { value: "Flyer" } });
    fireEvent.click(screen.getByTestId("preset-1080x1080"));
    fireEvent.click(screen.getByTestId("create-project-btn"));
    await waitFor(() => expect(client.createApp).toHaveBeenCalledWith("Flyer", "bundle-hash", { org: "org-1" }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-2", "updateDocument", {
        name: "Flyer",
        description: "",
        width: 1080,
        height: 1080,
      }),
    );
    expect(await screen.findByTestId("project-card-app-2")).toBeInTheDocument();
  });

  it("creates a team as an organization whose members may create projects", async () => {
    remember();
    window.history.replaceState(null, "", "/teams");
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.change(await screen.findByTestId("new-team-input"), { target: { value: "Agency" } });
    fireEvent.click(screen.getByTestId("create-team-btn"));
    await waitFor(() => expect(client.createOrg).toHaveBeenCalledWith("Agency"));
    expect(client.setCapabilities).toHaveBeenCalled();
    expect(await screen.findByTestId("team-card-org-2")).toHaveTextContent("Agency");
  });

  it("makes an invitation link with the inviter's passkey", async () => {
    remember();
    window.history.replaceState(null, "", "/teams/org-1/projects");
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText("Invitations"));
    fireEvent.click(screen.getByTestId("generate-invite"));
    await waitFor(() => expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything()));
    expect(await screen.findByTestId("invite-token")).toHaveAttribute("title", expect.stringContaining("invite=tok-123"));
  });
});

describe("an invitation link", () => {
  it("is kept through the sign-in, then redeemed into the team it names", async () => {
    window.history.replaceState(null, "", "/?invite=tok-9&project=app-1");
    captureInvite();
    expect(window.location.search).toBe("");
    remember();
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-9"));
    await waitFor(() => expect(window.location.pathname).toBe("/teams/org-1/projects/app-1"));
    expect(localStorage.getItem("mero-pixart:pending-invite")).toBeNull();
  });
});
