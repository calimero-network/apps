import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Where a visitor lands: the landing page signed out; signed in, the audience
// this browser remembers, but only once the account's instances of this app
// include it (it can name one deleted, left, or another account's).

const h = vi.hoisted(() => {
  const state = {
    status: "signed-in" as "connecting" | "signed-out" | "signed-in",
    apps: [] as string[],
    pending: null as Promise<void> | null,
  };
  const client = {
    listApps: vi.fn(async () => {
      if (state.pending) await state.pending;
      return state.apps.map((appId) => ({ appId, name: appId, org: "org-1" }));
    }),
  };
  return { state, client };
});

vi.mock("./lib/sessionContext", () => ({
  useSessionApi: () => ({
    api: {
      session:
        h.state.status === "signed-in"
          ? { status: "signed-in", client: h.client, accountId: "ana", target: { kind: "local", nodes: [] } }
          : h.state.status === "signed-out"
            ? { status: "signed-out", client: h.client, target: { kind: "local", nodes: [] } }
            : { status: "connecting" },
      busy: false,
      error: null,
    },
  }),
  useMaybeSignedIn: () =>
    h.state.status === "signed-in"
      ? {
          client: h.client,
          accountId: "ana",
          target: { kind: "local", nodes: [] },
          source: "bundle-1",
          passkey: () => ({}),
          after: () => {},
        }
      : null,
}));
vi.mock("./components/AudienceShell", () => ({ default: () => <p>updates</p> }));
vi.mock("./pages/CompaniesPage", () => ({ default: () => <p>companies</p> }));
vi.mock("./pages/AudiencesPage", () => ({ default: () => <p>audiences</p> }));
vi.mock("./pages/landing/LandingPage", () => ({ default: () => <p>landing</p> }));
vi.mock("./components/InvitationPrompt", () => ({ default: () => null }));
vi.mock("./components/SignInDialog", () => ({
  default: ({ open }: { open: boolean }) => (open ? <p>sign in</p> : null),
  // The invitation page's body; its copy is covered in App.invite.test.tsx.
  SignInBody: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

async function boot(path = "/") {
  const { default: App } = await import("./App");
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

async function remember(appId: string) {
  const { setActiveAudience } = await import("./lib/active");
  setActiveAudience(appId, "org-1");
}

beforeEach(() => {
  localStorage.clear();
  h.state.status = "signed-in";
  h.state.apps = [];
  h.state.pending = null;
  h.client.listApps.mockClear();
});

afterEach(cleanup);

describe("landing", () => {
  it("shows the landing page signed out", async () => {
    h.state.status = "signed-out";
    await boot();
    expect(await screen.findByText("landing")).toBeInTheDocument();
    expect(screen.queryByText("sign in")).toBeNull();
  });

  it("renders nothing while the session is still connecting", async () => {
    h.state.status = "connecting";
    await boot("/companies");
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("companies")).toBeNull();
    expect(screen.queryByText("landing")).toBeNull();
  });

  it("sends a signed-out visitor of an app route to the landing page", async () => {
    h.state.status = "signed-out";
    await boot("/a");
    expect(await screen.findByText("landing")).toBeInTheDocument();
  });

  it("shows an invitation link to a signed-out visitor as the invitation page, not the landing page", async () => {
    h.state.status = "signed-out";
    localStorage.setItem("mero-updates:pending-invite", JSON.stringify({ token: "t", audience: null }));
    await boot("/a");
    expect(await screen.findByTestId("invitation-page")).toBeInTheDocument();
    expect(screen.queryByText("landing")).toBeNull();
    expect(screen.queryByText("sign in")).toBeNull();
  });

  it("\"Not now\" on the invitation page shows the landing page and keeps the token", async () => {
    h.state.status = "signed-out";
    localStorage.setItem("mero-updates:pending-invite", JSON.stringify({ token: "t", audience: null }));
    await boot();
    fireEvent.click(await screen.findByTestId("invitation-not-now"));
    expect(await screen.findByText("landing")).toBeInTheDocument();
    expect(localStorage.getItem("mero-updates:pending-invite")).not.toBeNull();
  });
});

describe("a remembered audience", () => {
  it("reopens one the account can reach", async () => {
    await remember("app-1");
    h.state.apps = ["app-1"];
    await boot();
    expect(await screen.findByText("updates")).toBeInTheDocument();
    expect(h.client.listApps).toHaveBeenCalledWith({ bundle: "bundle-1" });
  });

  it("drops one the account cannot reach, and lands on the picker", async () => {
    await remember("app-gone");
    h.state.apps = ["app-other"];
    await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
    expect(screen.queryByText("updates")).toBeNull();
    const { getContextId } = await import("./lib/active");
    expect(getContextId()).toBeNull();
  });

  it("enters nothing before the node has answered", async () => {
    await remember("app-1");
    h.state.apps = ["app-1"];
    let answer!: () => void;
    h.state.pending = new Promise<void>((r) => (answer = r));
    await boot();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText("updates")).toBeNull();
    expect(screen.queryByText("companies")).toBeNull();
    answer();
    expect(await screen.findByText("updates")).toBeInTheDocument();
  });

  it("bounces a stale audience's post link to the picker, not a dead page", async () => {
    await remember("app-gone");
    await boot("/a/p/post-1");
    expect(await screen.findByText("companies")).toBeInTheDocument();
  });

  it("with nothing remembered, lands on the picker", async () => {
    await boot();
    expect(await screen.findByText("companies")).toBeInTheDocument();
  });
});
