// Opening the app goes back to the team you had open last instead of asking
// again (utils/lastVisit) — but only on the default landing, only while this
// node still lists that team, and never when you chose the list yourself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TeamsPage from "./TeamsPage";
import { ToastProvider } from "../contexts/ToastContext";
import { readLastVisit, rememberTeam } from "../utils/lastVisit";

const NODE = "http://node.example";

const stub = vi.hoisted(() => {
  const admin = {
    getNodeIdentity: vi.fn(async () => ({ accountId: "ab".repeat(32) })),
    listGroupMembers: vi.fn(async () => ({ members: [] })),
    listNamespacesForApplication: vi.fn(async () => [{ namespaceId: "ns-1", name: "One" }]),
    listNamespaces: vi.fn(async () => []),
    listApplications: vi.fn(async () => []),
  };
  return {
    admin,
    mero: {
      mero: { admin, rpc: { execute: vi.fn() } },
      admin,
      isDelegated: false,
      applicationId: "app",
      nodeUrl: "http://node.example",
      isAuthenticated: true,
      isLoading: false,
      logout: vi.fn(),
    },
  };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

/** `chosen`: reached by a link, not as the first page of the load. */
function renderAt(opts: { chosen?: boolean; resume?: boolean } = {}) {
  const teams = { pathname: "/teams", state: opts.resume ? { resume: true } : null };
  return render(
    <MemoryRouter initialEntries={opts.chosen ? ["/teams/ns-1/projects", teams] : [teams]} initialIndex={opts.chosen ? 1 : 0}>
      <ToastProvider>
        <Routes>
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamId/projects" element={<p>team page</p>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("TeamsPage resumes the last team", () => {
  it("stays on the list when it is reloaded (the first page of a load)", async () => {
    rememberTeam(NODE, "ns-1");
    renderAt();
    await screen.findByTestId("team-card-ns-1");
    expect(screen.queryByText("team page")).toBeNull();
  });

  it("opens it from the sign-in redirect", async () => {
    rememberTeam(NODE, "ns-1");
    renderAt({ chosen: true, resume: true });
    await screen.findByText("team page");
  });

  it("stays on the list you chose, without bouncing", async () => {
    rememberTeam(NODE, "ns-1");
    renderAt({ chosen: true });
    await screen.findByTestId("team-card-ns-1");
    expect(screen.queryByText("team page")).toBeNull();
  });

  it("shows the list and forgets a team the node no longer lists", async () => {
    rememberTeam(NODE, "gone");
    renderAt({ resume: true });
    await screen.findByTestId("team-card-ns-1");
    await waitFor(() => expect(readLastVisit(NODE).team).toBeUndefined());
    expect(screen.queryByText("team page")).toBeNull();
  });
});
