import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalimeroError, type AppInfo, type CalimeroClient, type CalimeroSession } from "@calimero-network/mero-js";
import { SessionStore, resolveTarget, targetKey } from "@calimero-apps/connect";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { APP } from "./session";
import { invites } from "./lib/spaces";

/** Hold an invite as a captured link would. */
function hold(link: { token: string; forum?: string | null; org?: string; route?: string }) {
  invites.put({
    token: link.token,
    org: link.org ?? null,
    team: null,
    doc: null,
    route: link.route ?? null,
    extra: link.forum ? { forum: link.forum } : {},
  });
}
import type { SessionDeps } from "./session";

// The landing page is generated and tested on its own; here it is the door.
vi.mock("./pages/landing/LandingPage", () => ({
  default: ({ onConnect }: { onConnect?: () => void }) => (
    <button type="button" onClick={onConnect}>
      Connect
    </button>
  ),
}));

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true;
  });
  proto.close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false;
  });
  window.scrollTo = vi.fn() as never;
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as Record<string, unknown>).IntersectionObserver = Observer;
});

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

const ME = "acct-alice";
const SESSION: CalimeroSession = { accountId: ME, sessionToken: "s", refreshToken: "r", expiresAt: 9e12 };
const DEV_ENV = { DEV: true, VITE_CALIMERO_BUNDLE: "bundle-hash" };

const FORUM: AppInfo = {
  appId: "forum-1",
  name: "General",
  owner: ME,
  org: "org-1",
  bundle: "bundle-hash",
  package: null,
  version: null,
};

const POST = {
  id: "p1",
  author: "acct-bob",
  authorName: "Bob",
  title: "Namespaces vs contexts",
  body: "When should an app create a subgroup?",
  createdAt: String(Date.now() - 60_000),
  editedAt: String(Date.now() - 60_000),
  score: "2",
  commentCount: "1",
  myVote: 1,
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
    me: vi.fn(async () => ({ orgs: [{ orgId: "org-1", name: "Team", role: "owner" }] })),
    getOrg: vi.fn(async () => ({ name: "Team", members: { [ME]: "owner", "acct-bob": "member" } })),
    listApps: vi.fn(async () => [FORUM]),
    call: vi.fn(async () => ({ index: 1, result: null, events: [] })),
    view: vi.fn(async (_app: string, method: string) => ({
      index: 1,
      result:
        method === "listPosts"
          ? { items: [POST], nextCursor: null }
          : method === "listComments"
            ? { items: [], nextCursor: null }
            : "",
    })),
    events: vi.fn(async function* () {}),
    redeemInvite: vi.fn(async () => ({ org: "org-1" })),
    setMemberMetadata: vi.fn(async () => undefined),
  };
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => client as unknown as CalimeroClient),
    passkey: () => ({ create: vi.fn(), get: vi.fn() }),
  };
}

/** A session (and, optionally, an open forum) an earlier visit left behind. */
function remember(forum?: AppInfo) {
  const target = resolveTarget(DEV_ENV);
  const store = new SessionStore(APP, target);
  store.sync({ session: SESSION } as unknown as CalimeroClient);
  if (forum) {
    localStorage.setItem(
      `mero-forum:active:${targetKey(target)}:${ME}`,
      JSON.stringify({ appId: forum.appId, org: forum.org }),
    );
  }
}

describe("App", () => {
  it("signs in with a passkey from the landing page and lands on the spaces", async () => {
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByText("Connect"));
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await screen.findByText("Your Spaces");
    expect(client.signIn).toHaveBeenCalled();
    await screen.findByText("Team");
    await waitFor(() => expect(client.listApps).toHaveBeenCalledWith({ bundle: "bundle-hash" }));
  });

  it("reopens the remembered forum and shows its feed in the screens' shapes", async () => {
    remember(FORUM);
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByText("Namespaces vs contexts");
    expect(client.view).toHaveBeenCalledWith("forum-1", "listPosts", { sort: "new", cursor: null, limit: 20 });
    // The score came over the wire as the string "2".
    expect(screen.getAllByText("2").length).toBeGreaterThan(0);
  });

  it("forgets a remembered forum this account no longer reaches", async () => {
    remember({ ...FORUM, appId: "gone" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByText("Your Spaces");
  });

  it("asks before redeeming an invitation, then lands in the forum the link names", async () => {
    remember();
    hold({ token: "tok-1", forum: "forum-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await screen.findByText("Namespaces vs contexts");
    expect(invites.token()).toBeNull();
  });

  it("shows an invitation page, not the landing page, to a signed-out visitor with an invite", async () => {
    hold({ token: "tok-1", forum: null });
    render(<App deps={deps(fakeClient())} />);
    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the space in Mero Forum/)).toBeTruthy();
    expect(screen.getByTestId("signin-passkey")).toBeTruthy();
    // A page, not a dialog over the landing page.
    expect(screen.queryByText("Connect")).toBeNull();
  });

  it("asks to join right after signing in from the invitation page, then lands in the forum", async () => {
    hold({ token: "tok-1", forum: "forum-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("signin-passkey"));
    await waitFor(() => expect(client.signIn).toHaveBeenCalled());
    // No second click to reach the prompt, and nothing redeemed before it.
    expect(client.redeemInvite).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId("invitation-join"));
    await waitFor(() => expect(client.redeemInvite).toHaveBeenCalledWith("tok-1"));
    await screen.findByText("Namespaces vs contexts");
  });

  it('"Not now" on the invitation page shows the landing page and keeps the invitation', async () => {
    hold({ token: "tok-1", forum: null });
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("invitation-later"));
    expect(await screen.findByText("Connect")).toBeTruthy();
    expect(invites.token()).toBe("tok-1");
  });

  it("an invited newcomer who creates the account on the invitation page lands in the forum the link names (B10)", async () => {
    window.history.replaceState(null, "", "/?invite=tok-1&forum=forum-1&org=org-1");
    invites.capture(window.location);
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("signup-passkey"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    await screen.findByText("Namespaces vs contexts");
    expect(window.location.pathname).toBe("/f");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it.each([
    [429, "RATE_LIMITED", /Too many tries/],
    [401, "UNAUTHENTICATED", /sign in again/],
  ])("keeps the invite when redeeming answers %i, and says to try again (B6)", async (status, code, says) => {
    remember();
    hold({ token: "tok-1", forum: null });
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(status, code, "not now"));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect((await screen.findByTestId("invitation-error")).textContent).toMatch(says);
    expect(invites.token()).toBe("tok-1");
  });

  it("tells a member of the invited space they are already in it, without spending the invite", async () => {
    remember();
    hold({ token: "tok-own", forum: null, org: "org-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect(await screen.findByText("You're already in this space")).toBeTruthy();
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
    fireEvent.click(screen.getByTestId("invitation-continue"));
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/org-1"));
  });

  it("says plainly when the invite was already used or has expired", async () => {
    remember();
    hold({ token: "tok-spent", forum: null });
    const client = fakeClient();
    client.redeemInvite.mockRejectedValueOnce(new CalimeroError(404, "NOT_FOUND", "unknown invite"));
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("invitation-join"));
    expect(
      await screen.findByText("This invite was already used or has expired. Ask the person who invited you for a new link."),
    ).toBeTruthy();
    expect(invites.token()).toBeNull();
  });

  it("creates a post through the log, and votes with camelCase arguments", async () => {
    remember(FORUM);
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    await screen.findByText("Namespaces vs contexts");

    fireEvent.focus(screen.getByLabelText("Start a discussion"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello" } });
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "World" } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("forum-1", "createPost", { title: "Hello", body: "World" }),
    );

    // Bob's post carries my upvote already; pressing it again retracts it.
    fireEvent.click((await screen.findAllByRole("button", { name: "Upvote" }))[0]!);
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("forum-1", "vote", { postId: "p1", value: 0 }),
    );
  });
});
