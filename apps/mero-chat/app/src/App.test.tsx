import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CalimeroClient, CalimeroSession } from "@calimero-network/mero-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import type { SessionDeps } from "./calimero/session";

// The marketing page and the chat itself are covered elsewhere; here they are
// stand-ins, so the test is about the session and the workspace gate.
vi.mock("./pages/landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button onClick={onConnect}>Open Mero Chat</button>
  ),
}));
vi.mock("./pages/Home", () => ({
  default: ({ org }: { org: string }) => <p>workspace {org}</p>,
}));

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

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
    me: vi.fn(async () => ({ name: "Alice", orgs: [{ orgId: "org-0", name: "Existing", role: "member" }] })),
    createOrg: vi.fn(async () => "org-1"),
    setMemberMetadata: vi.fn(async () => undefined),
    createApp: vi.fn(async () => "app-general"),
    redeemInvite: vi.fn(async () => ({ org: "org-9" })),
  };
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

function renderApp(d: SessionDeps) {
  return render(
    <MemoryRouter>
      <App deps={d} />
    </MemoryRouter>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("App", () => {
  it("says why a production build cannot connect", async () => {
    renderApp(deps(fakeClient(), { DEV: false }));
    await screen.findByText(/VITE_CALIMERO_CLUSTER is not set/);
  });

  it("signs up with a passkey, lists the account's workspaces, and creates one with its #general", async () => {
    const client = fakeClient();
    renderApp(deps(client));
    fireEvent.click(await screen.findByText("Open Mero Chat"));
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Create an account"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalled());

    // The workspaces the account is in, from the node's `/auth/me`.
    await screen.findByText(/Existing/);
    fireEvent.change(screen.getByLabelText("workspace name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Create workspace"));

    await screen.findByText("workspace org-1");
    expect(client.createOrg).toHaveBeenCalledWith("Acme");
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-1", "acct-alice", { name: "Alice" });
    expect(client.createApp).toHaveBeenCalledWith("#general", "bundle-hash", {
      org: "org-1",
      access: { kind: "org" },
      initArgs: { name: "general", contextType: "Channel", description: "", creatorUsername: "Alice" },
    });
    expect(localStorage.getItem("mero-chat:workspace")).toBe("org-1");
  });

  it("opens a workspace picked from the list", async () => {
    const client = fakeClient();
    renderApp(deps(client));
    fireEvent.click(await screen.findByText("Open Mero Chat"));
    fireEvent.click(screen.getByText("Sign in with a passkey"));
    fireEvent.click(await screen.findByText(/Existing/));
    await screen.findByText("workspace org-0");
  });

  it("redeems an invitation link opened before signing in, and opens that workspace", async () => {
    localStorage.setItem("mero-chat:pending-invite", "tok-1");
    const client = fakeClient();
    renderApp(deps(client));
    fireEvent.click(await screen.findByText("Open Mero Chat"));
    fireEvent.click(screen.getByText("Sign in with a passkey"));
    await screen.findByText("workspace org-9");
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-1");
    expect(client.setMemberMetadata).toHaveBeenCalledWith("org-9", "acct-alice", { name: "Alice" });
    expect(localStorage.getItem("mero-chat:pending-invite")).toBeNull();
  });
});
