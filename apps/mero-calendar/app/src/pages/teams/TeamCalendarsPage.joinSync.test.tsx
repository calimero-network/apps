/**
 * The calendar picker right after joining a team from an invitation.
 *
 * A member who has just joined holds none of the team's calendar contexts, so
 * a list built only from the contexts this node holds came back empty: the
 * invitation dialog settled on it and the person was told "No calendars in
 * this team yet" about a team that has some. The team's own calendars must be
 * listed (opening one joins it), and an empty read must not settle the gate
 * while the team is still just-joined.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";

const NS = "a1".repeat(32);
const CAL = "c0".repeat(32);
const APP = "app-calendar";

const stub = vi.hoisted(() => {
  const node = {
    /** Contexts per group, as `GET /groups/{id}/contexts` returns them. */
    contexts: {} as Record<string, { contextId: string; name?: string }[]>,
    /** The contexts this node itself holds for the application. */
    appContexts: [] as { contextId: string; applicationId: string }[],
    /** This application's namespaces, as the node lists them. */
    namespaces: [] as { namespaceId: string; targetApplicationId: string }[],
  };
  const admin = {
    listSubgroups: vi.fn(async () => []),
    listGroupContexts: vi.fn(async (id: string) => node.contexts[id] ?? []),
    getContextsForApplication: vi.fn(async () => node.appContexts),
    listNamespacesForApplication: vi.fn(async () => node.namespaces),
    getGroupMetadata: vi.fn(async () => ({ name: "Ops crew" })),
    setContextMetadata: vi.fn(async () => {}),
    joinContext: vi.fn(async () => ({ contextId: CAL, memberPublicKey: "pk" })),
  };
  // Stable, as the real hook's `useCallback` is: a new function per render
  // would re-run the page's load effect on every render.
  const ensureAppId = async () => "app-calendar";
  return { node, admin, ensureAppId, navigate: vi.fn() };
});

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => stub.navigate,
}));
vi.mock("@calimero-network/mero-react", async (orig) => ({
  ...(await orig<typeof import("@calimero-network/mero-react")>()),
  useMero: () => ({
    admin: stub.admin,
    isDelegated: false,
    applicationId: APP,
    isAuthenticated: true,
    isLoading: false,
    logout: vi.fn(),
  }),
  setApplicationId: vi.fn(),
  getApplicationId: () => "",
}));
vi.mock("../../hooks/useEnsureAppId", () => ({
  useEnsureAppId: () => stub.ensureAppId,
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));
vi.mock("../../components/common/theme-toggle/ThemeToggle", () => ({
  default: () => null,
}));
vi.mock("./TeamMembersPanel", () => ({ default: () => null }));

import TeamCalendarsPage from "./TeamCalendarsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/teams/${NS}`]}>
      <Routes>
        <Route path="/teams/:teamId" element={<TeamCalendarsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  stub.node.contexts = {};
  stub.node.appContexts = [];
  stub.node.namespaces = [{ namespaceId: NS, targetApplicationId: APP }];
});

afterEach(() => {
  clearNamespaceJustJoined(NS);
  vi.useRealTimers();
});

describe("TeamCalendarsPage right after joining the team", () => {
  it("lists a team calendar this node has not joined yet, settles on it, and joins it on open", async () => {
    markNamespaceJustJoined(NS);
    stub.node.contexts = { [NS]: [{ contextId: CAL, name: "Standup" }] };
    renderPage();

    const card = await screen.findByTestId(`calendar-card-${CAL}`);
    expect(card.textContent).toContain("Standup");
    await waitFor(() => expect(isNamespaceJustJoined(NS)).toBe(false));

    fireEvent.click(card);
    await waitFor(() =>
      expect(stub.navigate).toHaveBeenCalledWith(`/teams/${NS}/calendar/${CAL}`),
    );
    expect(stub.admin.joinContext).toHaveBeenCalledWith(CAL);
  });

  it("does not settle on an empty first read, and re-reads until a calendar arrives", async () => {
    markNamespaceJustJoined(NS);
    renderPage();
    await advance(100);
    expect(isNamespaceJustJoined(NS)).toBe(true);
    expect(screen.queryByTestId("empty-calendars")).toBeNull();

    stub.node.contexts = { [NS]: [{ contextId: CAL, name: "Standup" }] };
    await advance(2_500);

    expect(await screen.findByTestId(`calendar-card-${CAL}`)).toBeTruthy();
    await waitFor(() => expect(isNamespaceJustJoined(NS)).toBe(false));
  });

  it("shows a team that was not just joined as empty at once", async () => {
    renderPage();
    expect(await screen.findByTestId("empty-calendars")).toBeTruthy();
    const reads = stub.admin.listGroupContexts.mock.calls.length;
    await advance(5_000);
    expect(stub.admin.listGroupContexts.mock.calls.length).toBe(reads);
  });

  it("still hides a context the node cannot confirm is a calendar", async () => {
    // A team this node does not list as one of Mero Calendar's namespaces (a
    // deep link into another app's) proves nothing about what it holds.
    stub.node.namespaces = [];
    stub.node.contexts = { [NS]: [{ contextId: CAL, name: "Not ours" }] };
    renderPage();
    expect(await screen.findByTestId("empty-calendars")).toBeTruthy();
    expect(screen.queryByTestId(`calendar-card-${CAL}`)).toBeNull();
  });
});
