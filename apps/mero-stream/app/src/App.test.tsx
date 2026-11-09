import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage } from "@calimero-apps/connect";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import App from "./App";
import { SessionProvider } from "./SessionProvider";
import { ToastProvider } from "./contexts/ToastContext";
import { inviteLink } from "./lib/streams";
import { APP, type SessionDeps } from "./session";

class Memory implements KeyValueStorage {
  readonly items = new Map<string, string>();
  getItem(k: string) {
    return this.items.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.items.set(k, v);
  }
  removeItem(k: string) {
    this.items.delete(k);
  }
}

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const SESSION: CalimeroSession = {
  accountId: "acct-alice",
  sessionToken: "s",
  refreshToken: "r",
  expiresAt: 9e12,
};

function fakeClient() {
  let session: CalimeroSession | undefined;
  const apps: AppInfo[] = [];
  const orgs: { orgId: string; name: string; role: string }[] = [];
  const room = (app: string) => ({ appId: app, name: app, owner: "acct-alice", org: "org-1", bundle: "b", package: null, version: null });
  return {
    apps,
    orgs,
    room,
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
    me: vi.fn(async () => ({ accountId: "acct-alice", orgs })),
    getOrg: vi.fn(async (org: string) => ({
      name: orgs.find((o) => o.orgId === org)?.name ?? "Stream",
      members: { "acct-alice": "owner" },
      memberMetadata: {},
    })),
    listApps: vi.fn(async () => apps),
    getApp: vi.fn(async (app: string) => ({ appId: app })),
    createOrg: vi.fn(async (name: string) => {
      orgs.push({ orgId: "org-1", name, role: "Owner" });
      return "org-1";
    }),
    createApp: vi.fn(async (name: string) => {
      apps.push({ ...room("app-1"), name });
      return "app-1";
    }),
    call: vi.fn(async (_app: string, method: string, args: Record<string, unknown>) => ({
      index: 2,
      result:
        method === "join"
          ? { memberId: "acct-alice", username: args.username, joinedAt: args.now, updatedAt: args.now }
          : null,
      events: [],
    })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === "getStats"
          ? { name: "", memberCount: 0, liveFragments: 0, nextSeq: "0", oldestLiveSeq: "0", prunedFrames: "0" }
          : [],
    })),
    events: vi.fn(async function* () {}),
    publishPresence: vi.fn(async () => {}),
    presenceStream: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
    setMemberMetadata: vi.fn(async () => {}),
  };
}

const ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "b" };

function renderApp(client: ReturnType<typeof fakeClient>, path: string, signedIn = false) {
  const storage = new Memory();
  if (signedIn) new SessionStore(APP, resolveTarget(ENV), storage).save(SESSION);
  const deps: SessionDeps = {
    env: ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }) as never,
    storage,
  };
  return render(
    <SessionProvider deps={deps}>
      <MemoryRouter initialEntries={[path]}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe("App", () => {
  it("signs up with a passkey and creates a stream (an org), then a room in it (an app instance)", async () => {
    const client = fakeClient();
    renderApp(client, "/streams");

    // Signed out: the landing page; its connect opens the passkey sign-in.
    fireEvent.click((await screen.findAllByText(/^Sign in$/))[0]);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await screen.findByText("Your streams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    await screen.findByTestId("streams-empty");

    fireEvent.change(screen.getByTestId("stream-name-input"), { target: { value: "Team" } });
    fireEvent.click(screen.getByTestId("create-stream"));
    await waitFor(() => expect(client.createOrg).toHaveBeenCalledWith("Team"));
    await screen.findByText("No rooms in this stream");

    fireEvent.change(screen.getByTestId("room-name-input"), { target: { value: "Standup" } });
    fireEvent.click(screen.getByTestId("create-room"));
    await waitFor(() =>
      expect(client.createApp).toHaveBeenCalledWith("Standup", "b", {
        org: "org-1",
        initArgs: { name: "Standup" },
      }),
    );
    // Into the call, which joins the room's contract.
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith(
        "app-1",
        "join",
        expect.objectContaining({ username: "guest" }),
      ),
    );
  });

  it("invites to a stream with a passkey approval and shows the link", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    client.apps.push(client.room("app-1"));
    renderApp(client, "/streams/org-1", true);

    await screen.findByText("1 room");
    fireEvent.click(screen.getByTestId("invite-namespace"));
    const link = await screen.findByTestId("invite-link");
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
    expect(link.textContent).toContain("invite=tok-123");
    expect(link.textContent).toContain("stream=org-1");
  });

  it("signed out with a pending invite, shows the invitation page instead of the landing page", async () => {
    localStorage.setItem(
      "mero-stream:pending-invite",
      JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }),
    );
    renderApp(fakeClient(), "/streams/org-1");
    await screen.findByText("You're invited");
    expect(screen.getByTestId("signup-passkey")).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    expect(document.querySelector(".cal-lp-root")).toBeNull();
  });

  it("\"Not now\" on the invitation page shows the landing page and keeps the token", async () => {
    localStorage.setItem(
      "mero-stream:pending-invite",
      JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }),
    );
    renderApp(fakeClient(), "/");
    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    await waitFor(() => expect(document.querySelector(".cal-lp-root")).not.toBeNull());
    expect(localStorage.getItem("mero-stream:pending-invite")).not.toBeNull();
  });

  it("does not redeem an invite into a stream the account is already in", async () => {
    const client = fakeClient();
    client.orgs.push({ orgId: "org-1", name: "Team", role: "Owner" });
    localStorage.setItem(
      "mero-stream:pending-invite",
      JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }),
    );
    renderApp(client, "/streams", true);
    await screen.findByTestId("invitation-member");
    expect(screen.getByText("You're already in this stream")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(localStorage.getItem("mero-stream:pending-invite")).toBeNull();
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    localStorage.setItem(
      "mero-stream:pending-invite",
      JSON.stringify({ token: "tok-9", stream: "org-1", room: null, name: "Team" }),
    );
    renderApp(client, "/streams", true);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toBe(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(localStorage.getItem("mero-stream:pending-invite")).toBeNull();
  });

  it("redeems an opened room invitation after sign-in and opens that room", async () => {
    const client = fakeClient();
    client.apps.push(client.room("app-1"));
    // Not a member until the invitation is redeemed.
    client.redeemInvite.mockImplementation(async () => {
      client.orgs.push({ orgId: "org-1", name: "Team", role: "Member" });
      return {};
    });
    localStorage.setItem(
      "mero-stream:pending-invite",
      JSON.stringify({ token: "tok-9", stream: "org-1", room: "app-1", name: "Standup" }),
    );
    renderApp(client, "/");

    await screen.findByText("You're invited");
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-9"));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("app-1", "join", expect.anything()),
    );
    expect(localStorage.getItem("mero-stream:pending-invite")).toBeNull();
  });

  it("builds invitation links on this frontend's own origin", () => {
    expect(
      inviteLink("t", { stream: "o" }, { origin: "https://x.apps.calimero.network", pathname: "/" }),
    ).toBe("https://x.apps.calimero.network/?invite=t&stream=o");
  });
});
