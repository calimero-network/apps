// The team page right after joining a team from an invitation.
//
// A node that has not synced the team lists none of its projects, so the first
// read comes back empty. That read used to settle the invitation's "Syncing…"
// gate and the page then said "No projects yet" about a team that has some,
// and only re-read every 30s. While the team is just-joined an empty list does
// not settle: the page shows the syncing banner and re-reads every
// JOIN_SYNC_POLL_MS until the projects arrive.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  JOIN_SYNC_POLL_MS,
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";
import ProjectsPage from "./ProjectsPage";
import { ToastProvider } from "../contexts/ToastContext";

const TEAM = "cd".repeat(32);
const SUB = "ab".repeat(32);
const CTX = "ef".repeat(32);

const stub = vi.hoisted(() => {
  const node = { subgroups: [] as { groupId: string; name?: string }[], contexts: {} as Record<string, { contextId: string; name?: string }[]> };
  const admin = {
    listSubgroups: vi.fn(async () => node.subgroups),
    listGroupContexts: vi.fn(async (id: string) => node.contexts[id] ?? []),
    listGroupMembers: vi.fn(async () => ({ members: [] })),
    getGroupMetadata: vi.fn(async () => ({ name: "Studio" })),
    listApplications: vi.fn(),
  };
  const rpc = { execute: vi.fn(async () => null) };
  return {
    node,
    admin,
    mero: { mero: { admin, rpc }, admin, isDelegated: false, applicationId: "app", nodeUrl: "http://node", logout: vi.fn() },
  };
});

vi.mock("@calimero-network/mero-react", async (orig) => ({
  ...(await orig<typeof import("@calimero-network/mero-react")>()),
  useMero: () => stub.mero,
  setApplicationId: vi.fn(),
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/teams/${TEAM}/projects`]}>
      <ToastProvider>
        <Routes>
          <Route path="/teams/:teamId/projects" element={<ProjectsPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stub.node.subgroups = [];
  stub.node.contexts = {};
  stub.admin.listSubgroups.mockClear();
});

afterEach(() => {
  cleanup();
  clearNamespaceJustJoined(TEAM);
  vi.useRealTimers();
});

describe("ProjectsPage right after joining the team", () => {
  it("does not settle on an empty first read, and re-reads until the projects arrive", async () => {
    markNamespaceJustJoined(TEAM);
    renderPage();
    await advance(100);
    expect(stub.admin.listSubgroups).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined(TEAM)).toBe(true);
    expect(screen.queryByTestId("empty-projects")).toBeNull();

    stub.node.subgroups = [{ groupId: SUB, name: "Poster" }];
    stub.node.contexts = { [SUB]: [{ contextId: CTX, name: "Poster" }] };
    await advance(JOIN_SYNC_POLL_MS + 500);

    expect(await screen.findByTestId(`project-card-${CTX}`)).toBeTruthy();
    await waitFor(() => expect(isNamespaceJustJoined(TEAM)).toBe(false));
  });

  it("shows a team that was not just joined as empty at once, without fast polling", async () => {
    renderPage();
    expect(await screen.findByTestId("empty-projects")).toBeTruthy();
    const reads = stub.admin.listSubgroups.mock.calls.length;
    await advance(JOIN_SYNC_POLL_MS * 3);
    expect(stub.admin.listSubgroups.mock.calls.length).toBe(reads);
  });
});
