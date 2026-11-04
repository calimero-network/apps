import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotFound, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage, type Target } from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { selectionKey } from "./groups";
import type { SessionDeps } from "./session";
import { APP } from "./session";

afterEach(cleanup);

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

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

/** What the contract answers, as the node sends it: 64-bit integers as decimal strings. */
const VIEWS: Record<string, unknown> = {
  whoami: { account: ME },
  roster: [{ account: ME, name: "Alice" }],
  listPolls: [
    {
      poll_id: "p1",
      title: "Where is the offsite?",
      creator: ME,
      phase: "Voting",
      created_at: "1700000000000",
      ballots: 2,
    },
  ],
};

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  const client = {
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
    listApps: vi.fn(async () => apps),
    createOrg: vi.fn(async () => "org-1"),
    createApp: vi.fn(async (name: string) => {
      apps.push({ appId: "app-new", name, owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null });
      return "app-new";
    }),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({ index: 1, result: VIEWS[method] ?? null })),
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
  return client;
}

function deps(client: ReturnType<typeof fakeClient>, env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

const LOCAL: Target = resolveTarget(DEV_ENV);

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient(), { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Vote" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-vote")`.
    expect(open.getAttribute("href")).toBe("https://qpe2mqkuj625tmvqshuqe4n5mz5plntrdqnltdbahtprjk42hsta.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey, creates a voting group from the dev bundle, shows its polls and invites", async () => {
    const client = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByText("Create a passkey"));
    await screen.findByText("Choose a voting group");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    // The picker lists groups in an effect, after its heading has rendered.
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));

    fireEvent.change(screen.getByLabelText("Group name"), { target: { value: "Offsite" } });
    fireEvent.click(screen.getByText("Create voting group"));
    await screen.findByText("Where is the offsite?");
    expect(client.createOrg).toHaveBeenCalledWith("Offsite");
    expect(client.createApp).toHaveBeenCalledWith("Offsite", "bundle-hash", { org: "org-1" });
    expect(client.view).toHaveBeenCalledWith("app-new", "listPolls", {});
    expect(screen.getByText("2 ballots")).toBeTruthy();
    expect(storage.getItem(selectionKey(LOCAL, ME))).toContain("app-new");

    fireEvent.click(screen.getByText("Create invite link"));
    await screen.findByText(/invite=tok-123/);
    expect(client.invite).toHaveBeenCalledWith("org-1", "member", expect.anything());
  });

  it("joins the roster with a name", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Where is the offsite?");
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Alicia" } });
    fireEvent.click(screen.getByText("Rename"));
    await waitFor(() => expect(client.call).toHaveBeenCalledWith("app-1", "setName", { name: "Alicia" }));
  });

  it("restores the session and the group opened last time, and goes back to the picker", async () => {
    const client = fakeClient([
      { appId: "app-1", name: "Board", owner: ME, org: "org-1", bundle: "bundle-hash", package: null, version: null },
    ]);
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Where is the offsite?");
    expect(client.useSession).toHaveBeenCalledWith(SESSION);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(client.events).toHaveBeenCalledWith("app-1", 0, expect.anything());

    fireEvent.click(screen.getByLabelText("Change group"));
    await screen.findByText("Choose a voting group");
    await screen.findByText("Board");
  });

  it("redeems an invitation opened before signing in, once, and drops a refused one", async () => {
    const client = fakeClient();
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-9");
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("You're invited");
    fireEvent.click(screen.getByText("Continue with passkey"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();

    cleanup();
    const refusing = fakeClient();
    refusing.redeemInvite.mockRejectedValue(new NotFound("no such invite"));
    const storage2 = new Memory();
    storage2.setItem(`${APP}:pending-invite`, "tok-used");
    new SessionStore(APP, LOCAL, storage2).save(SESSION);
    render(<App deps={deps(refusing)} storage={storage2} />);
    await screen.findByText(/could not be accepted/);
    await waitFor(() => expect(storage2.getItem(`${APP}:pending-invite`)).toBeNull());
  });

  it("logs out, forgetting the session and the open group", async () => {
    const client = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, ME), JSON.stringify({ appId: "app-1", name: "Board", org: "org-1" }));
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Where is the offsite?");
    fireEvent.click(screen.getByTestId("logout-btn"));
    await screen.findByText("Continue with passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
    expect(storage.getItem(selectionKey(LOCAL, ME))).toBeNull();
  });
});
