import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Where a signed-in visitor lands, given the forum this browser remembers.
//
// The remembered forum is a context id in localStorage, and it is only
// meaningful on the node it was opened on, while that node still holds it.
// Connecting to another node (localhost:2528 -> 2529), or deleting or leaving
// the forum, used to route straight into it anyway: `/` sent you to /f and
// RequireForum only checked that SOME id was stored, so the feed rendered
// against a context this node does not have.

const h = vi.hoisted(() => {
  const node = {
    url: "http://localhost:2528" as string | null,
    // The ids `getContexts` answers with; a promise holds the answer back.
    contexts: [] as string[],
    pending: null as Promise<void> | null,
  };
  const admin = {
    getContexts: vi.fn(async () => {
      if (node.pending) await node.pending;
      return { contexts: node.contexts.map((id) => ({ id })) };
    }),
  };
  const session = {
    isAuthenticated: true,
    isLoading: false,
    admin,
    mero: { admin },
    get nodeUrl() {
      return node.url;
    },
  };
  return { node, admin, session };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
}));
vi.mock("./pages/FeedPage", () => ({ default: () => <p>feed</p> }));
vi.mock("./pages/PostPage", () => ({ default: () => <p>post</p> }));
vi.mock("./pages/SpacesPage", () => ({ default: () => <p>spaces</p> }));
vi.mock("./pages/ForumsPage", () => ({ default: () => <p>forums</p> }));
vi.mock("./pages/landing/LandingPage", () => ({
  default: () => <p>landing</p>,
}));
vi.mock("./components/InvitationPrompt", () => ({ default: () => null }));

const A = "http://localhost:2528";
const B = "http://localhost:2529";

/** What an earlier visit left in storage. `node` absent = an older build. */
function remember(ctx: string, node?: string) {
  localStorage.setItem(
    "ms-session",
    JSON.stringify({
      applicationId: "app-1",
      contextId: ctx,
      executorPublicKey: "exec-1",
      activeNamespaceId: "ns-1",
      ...(node === undefined ? {} : { forumNode: node }),
      devMode: false,
    }),
  );
  localStorage.setItem(
    "ms-space:app-1",
    JSON.stringify({
      ctx,
      executor: "exec-1",
      ns: "ns-1",
      ...(node === undefined ? {} : { node }),
    }),
  );
}

/** A fresh app load: session.ts boots from storage, as main.tsx does. */
async function boot(path = "/") {
  vi.resetModules();
  const session = await import("./lib/session");
  session.captureSessionFromHash();
  const { default: App } = await import("./App");
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return session;
}

beforeEach(() => {
  localStorage.clear();
  window.location.hash = "";
  h.node.url = A;
  h.node.contexts = [];
  h.node.pending = null;
  h.admin.getContexts.mockClear();
});

afterEach(cleanup);

describe("landing on a remembered forum", () => {
  it("reopens a forum this node lists", async () => {
    remember("ctx-1", A);
    h.node.contexts = ["ctx-1"];
    await boot();
    expect(await screen.findByText("feed")).toBeInTheDocument();
  });

  it("drops a forum this node does not list, and lands on the picker", async () => {
    remember("ctx-gone", A);
    h.node.contexts = ["ctx-other"];
    const session = await boot();
    expect(await screen.findByText("spaces")).toBeInTheDocument();
    expect(screen.queryByText("feed")).toBeNull();
    expect(session.getContextId()).toBeNull();
    expect(localStorage.getItem("ms-space:app-1")).toBeNull();
  });

  it("ignores a forum remembered on another node", async () => {
    remember("ctx-1", A);
    h.node.url = B;
    // Even an id that happens to exist here was chosen on a different node.
    h.node.contexts = ["ctx-1"];
    const session = await boot();
    expect(await screen.findByText("spaces")).toBeInTheDocument();
    expect(screen.queryByText("feed")).toBeNull();
    expect(session.getContextId()).toBeNull();
  });

  it("enters nothing before the node's list has answered", async () => {
    remember("ctx-1", A);
    h.node.contexts = ["ctx-1"];
    let answer!: () => void;
    h.node.pending = new Promise<void>((r) => (answer = r));
    await boot();
    // Let the router settle on whatever it renders before the answer.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("feed")).toBeNull();
    expect(screen.queryByText("spaces")).toBeNull();
    answer();
    expect(await screen.findByText("feed")).toBeInTheDocument();
  });

  it("reopens an older, node-less entry only once this node lists it", async () => {
    remember("ctx-1");
    h.node.contexts = ["ctx-1"];
    await boot();
    expect(await screen.findByText("feed")).toBeInTheDocument();
  });

  it("drops an older, node-less entry this node does not list", async () => {
    remember("ctx-1");
    h.node.contexts = [];
    const session = await boot();
    expect(await screen.findByText("spaces")).toBeInTheDocument();
    expect(session.getContextId()).toBeNull();
  });

  it("bounces a stale forum's post link to the picker, not a dead page", async () => {
    remember("ctx-gone", A);
    await boot("/p/post-1");
    expect(await screen.findByText("spaces")).toBeInTheDocument();
    expect(screen.queryByText("post")).toBeNull();
  });

  it("enters a forum just created or joined without waiting for the list", async () => {
    // A just-joined context may not be listed yet; the open itself vouches.
    h.node.pending = new Promise<void>(() => {});
    vi.resetModules();
    const session = await import("./lib/session");
    session.captureSessionFromHash();
    session.setActiveForum("ctx-new", "exec-1", "ns-1", A);
    const { default: App } = await import("./App");
    render(
      <MemoryRouter initialEntries={["/f"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("feed")).toBeInTheDocument();
  });

  it("with nothing remembered, lands on the picker as before", async () => {
    await boot();
    expect(await screen.findByText("spaces")).toBeInTheDocument();
  });
});
