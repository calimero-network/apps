/**
 * Opening the app goes back to the team you had open last instead of asking
 * again (utils/lastVisit) — but only on the default landing, only while this
 * node still lists that team, and never when you chose the list yourself.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAccountId } from "../../api/identity";
import { readLastVisit, rememberTeam } from "../../utils/lastVisit";

const NS = "a1".repeat(32);
const ME = "d4".repeat(32);
const NODE = "http://node.example";

const stub = vi.hoisted(() => {
  const admin = {
    listApplications: vi.fn(async () => {
      throw new Error("unreachable");
    }),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(async () => []),
    getNodeIdentity: vi.fn(),
    listGroupMembers: vi.fn(async () => ({ members: [] })),
  };
  return { admin, showToast: vi.fn() };
});

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({
    admin: stub.admin,
    isDelegated: false,
    applicationId: "app-1",
    nodeUrl: "http://node.example",
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => "",
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: stub.showToast }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
import TeamsPage from "./TeamsPage";

/** `chosen`: reached by a link, not as the first page of the load. */
function open(opts: { chosen?: boolean; resume?: boolean } = {}) {
  const teams = {
    pathname: "/teams",
    state: opts.resume ? { resume: true } : null,
  };
  return render(
    <MemoryRouter
      initialEntries={opts.chosen ? [`/teams/${NS}`, teams] : [teams]}
      initialIndex={opts.chosen ? 1 : 0}
    >
      <Routes>
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:teamId" element={<p>team page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetAccountId();
  stub.admin.listNamespacesForApplication.mockResolvedValue([
    { namespaceId: NS, targetApplicationId: "app-1", name: "Design" },
  ]);
  stub.admin.getNodeIdentity.mockResolvedValue({ accountId: ME });
});

describe("the teams list resumes the last team", () => {
  it("stays on the list when it is reloaded (the first page of a load)", async () => {
    rememberTeam(NODE, NS);
    open();
    await screen.findByTestId(`team-card-${NS}`);
    expect(screen.queryByText("team page")).toBeNull();
  });

  it("opens it from the sign-in redirect", async () => {
    rememberTeam(NODE, NS);
    open({ chosen: true, resume: true });
    await screen.findByText("team page");
  });

  it("stays on the list you chose, without bouncing", async () => {
    rememberTeam(NODE, NS);
    open({ chosen: true });
    await screen.findByTestId(`team-card-${NS}`);
    expect(screen.queryByText("team page")).toBeNull();
  });

  it("shows the list and forgets a team the node no longer lists", async () => {
    rememberTeam(NODE, "gone");
    open({ resume: true });
    await screen.findByTestId(`team-card-${NS}`);
    await waitFor(() => expect(readLastVisit(NODE).team).toBeUndefined());
    expect(screen.queryByText("team page")).toBeNull();
  });
});
