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
// A shared org (`appOnly`) is Calimero Home's to set up; here only what the invite dialog is handed.
const teamsAnswer = vi.hoisted(() => ({ appOnly: null as boolean | null }));
vi.mock("@calimero-apps/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@calimero-apps/connect")>();
  return {
    ...actual,
    appInviteTeams: (...args: Parameters<typeof actual.appInviteTeams>) =>
      teamsAnswer.appOnly === null
        ? actual.appInviteTeams(...args)
        : Promise.resolve({ teams: [], appOnly: teamsAnswer.appOnly }),
  };
});
// The shared dialog is mero-react's to test: here only what the app hands it and does after.
vi.mock("@calimero-network/mero-react", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<object>()),
    CreateWorkspaceDialog: (p: {
      open: boolean;
      defaultSelfName?: string;
      release: unknown;
      labels?: { title?: string };
      onCreated: (w: { orgId: string; name: string; selfName: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "create-dialog" },
            createElement("h2", { "data-testid": "create-title" }, p.labels?.title),
            createElement("p", { "data-testid": "create-self" }, p.defaultSelfName),
            createElement("pre", { "data-testid": "create-release" }, JSON.stringify(p.release)),
            createElement(
              "button",
              { "data-testid": "create-done", onClick: () => p.onCreated({ orgId: "org-new", name: "Fresh", selfName: "Ana" }) },
              "done",
            ),
          )
        : null,
    AcceptInviteDialog: (p: {
      open: boolean;
      token: string;
      org?: string;
      appName?: string;
      labels?: { noun?: string };
      onClose: () => void;
      onError?: (e: unknown) => void;
      onJoined: (j: { org: string }) => void;
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "accept-dialog" },
            createElement("p", { "data-testid": "accept-token" }, `${p.token}|${p.appName}|${p.org}|${p.labels?.noun}`),
            createElement("button", { "data-testid": "accept-done", onClick: () => p.onJoined({ org: "org-1" }) }, "join"),
            createElement("button", { "data-testid": "accept-close", onClick: p.onClose }, "not now"),
            createElement(
              "button",
              {
                "data-testid": "accept-spent",
                onClick: () => p.onError?.(new CalimeroError(400, "REJECTED", "this invite was used up, revoked or never existed")),
              },
              "spent",
            ),
            createElement(
              "button",
              { "data-testid": "accept-lapsed", onClick: () => p.onError?.(new CalimeroError(401, "UNAUTHORIZED", "session ended")) },
              "lapsed",
            ),
          )
        : null,
    InviteDialog: (p: {
      open: boolean;
      org: string;
      teams?: string[];
      linkBase?: string;
      appName?: string;
      labels?: { title?: string; noun?: string; note?: string };
    }) =>
      p.open
        ? createElement(
            "div",
            { "data-testid": "invite-dialog" },
            createElement("p", { "data-testid": "invite-title" }, p.labels?.title),
            createElement("p", { "data-testid": "invite-labels" }, `${p.labels?.noun}|${p.labels?.note ?? ""}`),
            createElement(
              "pre",
              { "data-testid": "invite-props" },
              JSON.stringify({ org: p.org, teams: p.teams, linkBase: p.linkBase, appName: p.appName }),
            ),
          )
        : null,
  };
});

const HOST = `https://${"a".repeat(52)}.apps.calimero.network`;

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
  sessionStorage.clear();
  release.href = null;
  release.navigate.mockClear();
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
  deployment: null,
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
  return withRoutes({
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
  });
}

function deps(client: ReturnType<typeof fakeClient>): SessionDeps {
  return {
    env: DEV_ENV,
    makeClient: vi.fn(async () => withRoutes(client)),
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

  it("opens the shared dialog for a new space, then names you in it and opens it", async () => {
    remember();
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    fireEvent.click(await screen.findByTestId("create-space"));
    expect((await screen.findByTestId("create-title")).textContent).toBe("New space");
    expect(JSON.parse(screen.getByTestId("create-release").textContent ?? "null")).toEqual({ package: "com.calimero.mero-forum" });
    fireEvent.click(screen.getByTestId("create-done"));
    await waitFor(() => expect(client.setMemberMetadata).toHaveBeenCalledWith("org-new", ME, { name: "Ana" }));
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/org-new"));
    expect(screen.queryByTestId("create-dialog")).toBeNull();
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
    expect((await screen.findByTestId("accept-token")).textContent).toBe("tok-1|Hyperfeed Forum|undefined|space");
    fireEvent.click(screen.getByTestId("accept-done"));
    await screen.findByText("Namespaces vs contexts");
    expect(invites.token()).toBeNull();
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("drops the invitation on Not now and shows the app", async () => {
    remember();
    hold({ token: "tok-1", forum: null });
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("accept-close"));
    await screen.findByText("Your Spaces");
    expect(invites.token()).toBeNull();
    expect(screen.queryByTestId("accept-dialog")).toBeNull();
  });

  it("adds the app-only note to the invite of a shared org, and none otherwise", async () => {
    remember();
    teamsAnswer.appOnly = true;
    try {
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByLabelText("More options"));
      fireEvent.click(await screen.findByTestId("invite-btn"));
      expect((await screen.findByTestId("invite-labels")).textContent).toBe(
        "space|Invites to Hyperfeed Forum only: this organization's other apps are managed in Calimero Home.",
      );
      cleanup();
      teamsAnswer.appOnly = false;
      render(<App deps={deps(fakeClient())} />);
      fireEvent.click(await screen.findByLabelText("More options"));
      fireEvent.click(await screen.findByTestId("invite-btn"));
      expect((await screen.findByTestId("invite-labels")).textContent).toBe("space|");
    } finally {
      teamsAnswer.appOnly = null;
    }
  });

  it("opens the shared invite dialog for a space, naming its link and app", async () => {
    remember();
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByLabelText("More options"));
    fireEvent.click(await screen.findByTestId("invite-btn"));
    const props = JSON.parse((await screen.findByTestId("invite-props")).textContent ?? "null");
    expect(props).toMatchObject({ org: "org-1", teams: [], appName: "Hyperfeed Forum" });
    expect(props.linkBase).toMatch(/\?org=org-1$/);
  });

  it("shows an invitation page, not the landing page, to a signed-out visitor with an invite", async () => {
    hold({ token: "tok-1", forum: null });
    render(<App deps={deps(fakeClient())} />);
    expect(await screen.findByTestId("invitation-page")).toBeTruthy();
    expect(screen.getByText(/You've been invited to join the space in Hyperfeed Forum/)).toBeTruthy();
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
    fireEvent.click(await screen.findByTestId("accept-done"));
    await screen.findByText("Namespaces vs contexts");
    expect(client.redeemInvite).not.toHaveBeenCalled();
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
    fireEvent.click(await screen.findByTestId("signup-create"));
    await waitFor(() => expect(client.signUp).toHaveBeenCalledWith(expect.anything(), "", { invite: "tok-1" }));
    await screen.findByText("Namespaces vs contexts");
    expect(window.location.pathname).toBe("/f");
    expect(client.redeemInvite).not.toHaveBeenCalled();
    expect(invites.token()).toBeNull();
  });

  it("invites to a space from its page, naming the space and its link", async () => {
    remember();
    window.history.replaceState(null, "", "/spaces/org-1");
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("invite-space"));
    expect((await screen.findByTestId("invite-title")).textContent).toBe("Invite to Team");
    expect(JSON.parse(screen.getByTestId("invite-props").textContent ?? "null").linkBase).toMatch(/\?org=org-1$/);
  });

  it("hands the link's space to the dialog, which tells a member without spending the invite", async () => {
    remember();
    hold({ token: "tok-own", forum: null, org: "org-1" });
    const client = fakeClient();
    render(<App deps={deps(client)} />);
    expect((await screen.findByTestId("accept-token")).textContent).toBe("tok-own|Hyperfeed Forum|org-1|space");
    expect(client.redeemInvite).not.toHaveBeenCalled();
  });

  it("a member who continues drops the invite and opens the space", async () => {
    remember();
    hold({ token: "tok-own", forum: null, org: "org-1" });
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("accept-done"));
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/org-1"));
    expect(invites.token()).toBeNull();
  });

  it("a spent invite is dropped from storage but stays on screen until Not now", async () => {
    remember();
    hold({ token: "tok-spent", forum: null });
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("accept-spent"));
    expect(invites.token()).toBeNull();
    expect(screen.getByTestId("accept-dialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("accept-close"));
    await waitFor(() => expect(screen.queryByTestId("accept-dialog")).toBeNull());
  });

  it("keeps the invite when the failure is a lapsed session, not the invite", async () => {
    remember();
    hold({ token: "tok-keep", forum: null });
    render(<App deps={deps(fakeClient())} />);
    fireEvent.click(await screen.findByTestId("accept-lapsed"));
    expect(invites.token()).toBe("tok-keep");
  });

  it("tells a member who may not add a forum to ask an owner, instead of offering Create (B8)", async () => {
    remember();
    const client = fakeClient();
    // A member whose space defaults were never set (the step-up refused): no CREATE_APP.
    client.getOrg.mockResolvedValue({ name: "Team", members: { [ME]: "member", "acct-bob": "owner" } });
    window.history.replaceState(null, "", "/spaces/org-1");
    render(<App deps={deps(client)} />);
    expect((await screen.findByTestId("create-forum-ask")).textContent).toMatch(/Only an owner or admin/);
    expect(screen.queryByTestId("create-forum")).toBeNull();
    expect(screen.queryByRole("button", { name: "New forum" })).toBeNull();
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

    // The feed is read again once the post is created, replacing every card:
    // wait for that read, or the click lands on a card about to be unmounted.
    await waitFor(() => expect(client.view.mock.calls.filter(([, method]) => method === "listPosts")).toHaveLength(2));

    // Bob's post carries my upvote already; pressing it again retracts it.
    fireEvent.click((await screen.findAllByRole("button", { name: "Upvote" }))[0]!);
    await waitFor(() =>
      expect(client.call).toHaveBeenCalledWith("forum-1", "vote", { postId: "p1", value: 0 }),
    );
  });
});

describe("the release the open forum runs (useInstanceRelease)", () => {
  /** The remembered forum's feed, while `forum-1` runs `version`. */
  function openForum(version: string) {
    remember(FORUM);
    const client = Object.assign(fakeClient(), withRoutes({
      getApp: vi.fn(async () => ({ appId: "forum-1", org: "org-1" })),
      appsReportAll: vi.fn(async () => ({ apps: [{ app: "forum-1", package: { package: "com.calimero.forum", version } }] })),
    }));
    window.history.replaceState(null, "", "/f");
    render(<App deps={deps(client)} />);
    return client;
  }

  it("moves a served page to the frontend of the release the forum runs, and shows nothing of it meanwhile", async () => {
    release.href = `${HOST}/1.2.0/f?sort=top`;
    openForum("1.0.0");
    await waitFor(() => expect(release.navigate).toHaveBeenCalledWith(`${HOST}/app/forum-1/f?sort=top`));
    expect(release.navigate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText("Namespaces vs contexts")).toBeNull());
  });

  it("stays on a served page of the release the forum runs", async () => {
    release.href = `${HOST}/1.2.0/f`;
    const client = openForum("1.2.0");
    await screen.findByText("Namespaces vs contexts");
    await waitFor(() => expect(client.appsReportAll).toHaveBeenCalledWith("org-1"));
    await new Promise((r) => setTimeout(r, 0));
    expect(release.navigate).not.toHaveBeenCalled();
    expect(screen.getByText("Namespaces vs contexts")).toBeTruthy();
  });

  it("does nothing in development", async () => {
    const client = openForum("1.0.0");
    await screen.findByText("Namespaces vs contexts");
    await new Promise((r) => setTimeout(r, 0));
    expect(client.getApp).not.toHaveBeenCalled();
    expect(release.navigate).not.toHaveBeenCalled();
  });
});
