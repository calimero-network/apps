import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NotFound, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, type KeyValueStorage, type Target } from "@calimero-apps/connect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import type { SessionDeps } from "./session";
import { APP } from "./session";
import { selectionKey } from "./teams";

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

const SESSION: CalimeroSession = { accountId: "acct-alice", sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };
const LOCAL: Target = resolveTarget(DEV_ENV);

/** A team as the contract answers its views. */
function contract() {
  const state = { teamName: "", names: {} as Record<string, string>, posted: [] as unknown[] };
  const view = vi.fn(async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    const result = (() => {
      switch (method) {
        case "whoami":
          return "acct-alice";
        case "getName":
          return state.names[args.account as string] ?? "";
        case "teamName":
          return state.teamName;
        case "getDay":
          return { day: args.day, updates: state.posted };
        case "getWeek":
          return [];
        case "members":
        case "currentBlockers":
        case "tags":
          return [];
        case "listDays":
          return { days: [], nextCursor: null };
        case "listDecisions":
          return { items: [], nextCursor: null };
        default:
          throw new Error(`unexpected view ${method}`);
      }
    })();
    return { index: 1, result };
  });
  const call = vi.fn(async (_app: string, method: string, args: Record<string, unknown> = {}) => {
    if (method === "setTeamName") state.teamName = args.name as string;
    if (method === "setName") state.names["acct-alice"] = args.name as string;
    if (method === "postUpdate") {
      state.posted = [
        {
          ...args,
          author: "acct-alice",
          authorName: state.names["acct-alice"] ?? "",
          createdAt: "1700000000000",
          editedAt: "1700000000000",
          helpers: [],
        },
      ];
    }
    return { index: 2, result: null, events: [] };
  });
  return { state, view, call };
}

function fakeClient(apps: AppInfo[] = []) {
  let session: CalimeroSession | undefined;
  const team = contract();
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
      apps.push({ appId: "app-new", name, owner: "acct-alice", org: "org-1", bundle: "bundle-hash", package: null, version: null });
      return "app-new";
    }),
    call: team.call,
    view: team.view,
    events: vi.fn(async function* () {}),
    invite: vi.fn(async () => "tok-123"),
    redeemInvite: vi.fn(async () => ({})),
  };
  return { client, team };
}

function deps(client: ReturnType<typeof fakeClient>["client"], env: SessionDeps["env"] = DEV_ENV): SessionDeps {
  return {
    env,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

describe("App", () => {
  it("shows the listing on a production copy no cluster serves", async () => {
    render(<App deps={deps(fakeClient().client, { DEV: false })} storage={new Memory()} />);
    const open = await screen.findByRole("link", { name: "Open Mero Standup" });
    // The node-served copy: mdma's `app_host.app_url("com.calimero.mero-standup")`.
    expect(open.getAttribute("href")).toBe("https://qhccatngyvytjdczbj4ffuikquvmcffnf7kwju6uyr3cmp652uxa.apps.calimero.network/");
    expect(screen.getByRole("link", { name: "Deploy your own on Calimero Cloud" }).getAttribute("href")).toBe(
      "https://cloud.calimero.network/v2",
    );
    expect(screen.queryByText(/VITE_CALIMERO_CLUSTER/)).toBeNull();
  });

  it("signs up with a passkey, starts a team from the dev bundle, names it, and posts an update", async () => {
    const { client, team } = fakeClient();
    const storage = new Memory();
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText(/Connected to merod local \(3 nodes\)/);
    fireEvent.click(screen.getByText("Create a passkey"));
    await screen.findByText("Your teams");
    expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "");
    expect(new SessionStore(APP, LOCAL, storage).load()).toEqual(SESSION);
    expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" });

    fireEvent.change(screen.getByLabelText("team name"), { target: { value: "Platform" } });
    fireEvent.click(screen.getByText("Start a new team"));
    await screen.findByText("Welcome to the team");
    expect(client.createOrg).toHaveBeenCalledWith("Platform");
    expect(client.createApp).toHaveBeenCalledWith("Platform", "bundle-hash", { org: "org-1" });
    expect(team.call).toHaveBeenCalledWith("app-new", "setTeamName", { name: "Platform" });
    await screen.findByText("Platform");
    expect(JSON.parse(storage.getItem(selectionKey(LOCAL, "acct-alice"))!)).toMatchObject({ appId: "app-new" });

    fireEvent.change(screen.getByLabelText("your name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByText("Continue"));
    await waitFor(() => expect(team.call).toHaveBeenCalledWith("app-new", "setName", { name: "Alice" }));
    await waitFor(() => expect(screen.queryByText("Welcome to the team")).toBeNull());

    fireEvent.change(screen.getByLabelText("done"), { target: { value: "Wrote the guide" } });
    fireEvent.click(screen.getByText("Post update"));
    await waitFor(() =>
      expect(team.call).toHaveBeenCalledWith("app-new", "postUpdate", expect.objectContaining({ done: "Wrote the guide" })),
    );
    await screen.findByText("Wrote the guide");
    expect(client.events).toHaveBeenCalledWith("app-new", 0, expect.anything());
  });

  it("restores the session and the team opened last time, and invites into the team's org", async () => {
    const { client, team } = fakeClient([
      { appId: "app-1", name: "Infra", owner: "acct-alice", org: "org-9", bundle: "bundle-hash", package: null, version: null },
    ]);
    team.state.teamName = "Infra";
    team.state.names["acct-alice"] = "Alice";
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    storage.setItem(selectionKey(LOCAL, "acct-alice"), JSON.stringify({ appId: "app-1", name: "Infra", org: "org-9" }));
    render(<App deps={deps(client)} storage={storage} />);

    await screen.findByText("Infra");
    expect(client.useSession).toHaveBeenCalledWith(SESSION);
    expect(client.signIn).not.toHaveBeenCalled();
    expect(team.view).toHaveBeenCalledWith("app-1", "whoami", {});

    fireEvent.click(screen.getByRole("tab", { name: "Invite" }));
    fireEvent.click(await screen.findByText("Create invite link"));
    // The link names the org, so a member opening it is told rather than spending it.
    await screen.findByText(/invite=tok-123&org=org-9/);
    expect(client.invite).toHaveBeenCalledWith("org-9", "member", expect.anything());

    fireEvent.click(screen.getByLabelText("account menu"));
    fireEvent.click(screen.getByText("Switch team"));
    await screen.findByText("Your teams");
  });

  it("shows a signed-out visitor with an invitation an invitation page, and \"Not now\" keeps it", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-9");
    render(<App deps={deps(client)} storage={storage} />);
    const page = await screen.findByTestId("invitation-page");
    expect(page.textContent).toContain(
      "You've been invited to join a team in Mero Standup. Sign in or create an account to accept.",
    );
    expect(screen.queryByText(/Async standups and a decision log/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByTestId("invitation-later"));
    await screen.findByText(/Async standups and a decision log/);
    expect(storage.getItem(`${APP}:pending-invite`)).toBe("tok-9");
  });

  it("asks to join right after signing in, and redeems only on Join", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-9");
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByTestId("invitation-page");
    fireEvent.click(screen.getByText("Continue with passkey"));
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(/Invitation accepted/);
    expect(client.redeemInvite).toHaveBeenCalledTimes(1);
    expect(client.redeemInvite).toHaveBeenCalledWith("tok-9");
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("tells a member of the invited org they are already in it, without spending the invite", async () => {
    const { client } = fakeClient();
    Object.assign(client, { me: vi.fn(async () => ({ accountId: "acct-alice", orgs: [{ orgId: "org-9" }] })) });
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-9");
    storage.setItem(`${APP}:pending-invite-org`, "org-9");
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    expect((await screen.findByTestId("invitation-outcome")).textContent).toContain("You're already in this team");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await screen.findByText("Your teams");
  });

  it("says plainly when the invite was already used or has expired", async () => {
    const refusing = fakeClient().client;
    refusing.redeemInvite.mockRejectedValue(new NotFound("no such invite"));
    const storage = new Memory();
    storage.setItem(`${APP}:pending-invite`, "tok-used");
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(refusing)} storage={storage} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await screen.findByText(
      "This invite was already used or has expired. Ask the person who invited you for a new link.",
    );
    expect(storage.getItem(`${APP}:pending-invite`)).toBeNull();
  });

  it("logs out and forgets the session", async () => {
    const { client } = fakeClient();
    const storage = new Memory();
    new SessionStore(APP, LOCAL, storage).save(SESSION);
    render(<App deps={deps(client)} storage={storage} />);
    await screen.findByText("Your teams");
    fireEvent.click(screen.getByLabelText("account menu"));
    fireEvent.click(screen.getByText("Log out"));
    await screen.findByText("Continue with passkey");
    expect(client.signOut).toHaveBeenCalled();
    expect(new SessionStore(APP, LOCAL, storage).load()).toBeNull();
  });
});
