import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-apps/cloud";

// A stream this session just joined. Right after the join the node may not
// hold its rooms yet, so the subgroup list comes back empty. That is not the
// stream's real answer, so it may not settle the join-sync gate (which closes
// the invitation dialog onto "No rooms in this stream"); the page re-reads
// until the rooms land.

const h = vi.hoisted(() => {
  const node = { subgroups: [] as { groupId: string }[] };
  const admin = {
    getNamespace: vi.fn(async () => ({ name: "Team" })),
    listNamespaceGroups: vi.fn(async () => node.subgroups),
    listGroupContexts: vi.fn(async () => [{ contextId: "ctx-a" }]),
    listGroupMembers: vi.fn(async () => ({ members: [] as unknown[] })),
    getGroupMetadata: vi.fn(async () => ({ name: "Standup" })),
    getContextIdentitiesOwned: vi.fn(async () => ({
      identities: [] as string[],
    })),
  };
  // Stable across renders, like the real provider's clients.
  const session = {
    admin,
    mero: { admin, rpc: { execute: vi.fn(async () => []) } },
    isDelegated: false,
    logout: () => {},
    nodeUrl: null,
  };
  return { node, admin, session };
});

vi.mock("@calimero-apps/cloud", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
}));

vi.mock("@calimero-apps/names", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMemberNames: () => ({ nameOf: () => null }),
}));

vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => ({
    appId: "app-1",
    resolving: false,
    notInstalled: false,
  }),
}));

import RoomsPage from "./RoomsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/streams/ns-1"]}>
      <Routes>
        <Route path="/streams/:namespaceId" element={<RoomsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  h.node.subgroups = [];
  h.admin.listNamespaceGroups.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("RoomsPage right after joining the stream", () => {
  it("does not settle on an empty room list, and re-reads until the rooms arrive", async () => {
    markNamespaceJustJoined("ns-1");
    renderPage();
    await advance(100);
    expect(screen.queryByText("No rooms in this stream")).toBeNull();
    expect(isNamespaceJustJoined("ns-1")).toBe(true);
    const readsBefore = h.admin.listNamespaceGroups.mock.calls.length;

    h.node.subgroups = [{ groupId: "room-a" }];
    await advance(2_500);

    expect(h.admin.listNamespaceGroups.mock.calls.length).toBeGreaterThan(
      readsBefore,
    );
    expect(await screen.findByTestId("room-row")).toBeTruthy();
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });

  it("settles at once on an empty list for a stream not just joined", async () => {
    renderPage();
    expect(await screen.findByText("No rooms in this stream")).toBeTruthy();
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });
});
