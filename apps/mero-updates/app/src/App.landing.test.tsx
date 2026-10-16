import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Where a signed-in visitor lands, given the audience this browser remembers.
//
// The remembered audience is a context id in localStorage, and it is only
// meaningful on the node it was opened on, while that node still holds it.
// Connecting to another node (localhost:2528 -> 2529), or deleting or leaving
// the audience, used to route straight into it anyway: `/` sent you to /a and
// RequireAudience only checked that SOME id was stored, so the updates feed
// rendered against a context this node does not have.

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
vi.mock("./components/AudienceShell", () => ({
  default: () => <p>updates</p>,
}));
vi.mock("./pages/CompaniesPage", () => ({ default: () => <p>companies</p> }));
vi.mock("./pages/AudiencesPage", () => ({ default: () => <p>audiences</p> }));
vi.mock("./pages/landing/LandingPage", () => ({
  default: () => <p>landing</p>,
}));
vi.mock("./components/InvitationPrompt", () => ({ default: () => null }));

const A = "http://localhost:2528";
const B = "http://localhost:2529";

/** What an earlier visit left in storage. `node` absent = an older build. */
function remember(ctx: string, node?: string) {
  localStorage.setItem(
    "mu-session",
    JSON.stringify({
      applicationId: "app-1",
      contextId: ctx,
      executorPublicKey: "exec-1",
      activeNamespaceId: "ns-1",
      ...(node === undefined ? {} : { audienceNode: node }),
      devMode: false,
    }),
  );
  localStorage.setItem(
    "mu-space:app-1",
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

describe("landing on a remembered audience", () => {
  it("reopens an audience this node lists", async () => {
    remember("ctx-1", A);
    h.node.contexts = ["ctx-1"];
    await boot();
    expect(await screen.findByText("updates")).toBeInTheDocument();
  });

  it("drops an audience this node does not list, and lands on the picker", async () => {
    remember("ctx-gone", A);
    h.node.contexts = ["ctx-other"];
    const session = await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
    expect(screen.queryByText("updates")).toBeNull();
    expect(session.getContextId()).toBeNull();
    expect(localStorage.getItem("mu-space:app-1")).toBeNull();
  });

  it("ignores an audience remembered on another node", async () => {
    remember("ctx-1", A);
    h.node.url = B;
    // Even an id that happens to exist here was chosen on a different node.
    h.node.contexts = ["ctx-1"];
    const session = await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
    expect(screen.queryByText("updates")).toBeNull();
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
    expect(screen.queryByText("updates")).toBeNull();
    expect(screen.queryByText("companies")).toBeNull();
    answer();
    expect(await screen.findByText("updates")).toBeInTheDocument();
  });

  it("reopens an older, node-less entry only once this node lists it", async () => {
    remember("ctx-1");
    h.node.contexts = ["ctx-1"];
    await boot();
    expect(await screen.findByText("updates")).toBeInTheDocument();
  });

  it("drops an older, node-less entry this node does not list", async () => {
    remember("ctx-1");
    h.node.contexts = [];
    const session = await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
    expect(session.getContextId()).toBeNull();
  });

  it("bounces a stale audience's post link to the picker, not a dead page", async () => {
    remember("ctx-gone", A);
    await boot("/a/p/post-1");
    expect(await screen.findByText("companies")).toBeInTheDocument();
    expect(screen.queryByText("updates")).toBeNull();
  });

  it("enters an audience just created or joined without waiting for the list", async () => {
    // A just-joined context may not be listed yet; the open itself vouches.
    h.node.pending = new Promise<void>(() => {});
    vi.resetModules();
    const session = await import("./lib/session");
    session.captureSessionFromHash();
    session.setActiveAudience("ctx-new", "exec-1", "ns-1", A);
    const { default: App } = await import("./App");
    render(
      <MemoryRouter initialEntries={["/a"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByText("updates")).toBeInTheDocument();
  });

  it("with nothing remembered, lands on the picker as before", async () => {
    await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
  });
});
