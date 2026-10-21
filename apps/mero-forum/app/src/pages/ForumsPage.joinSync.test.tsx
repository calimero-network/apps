import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";

// A space this session just joined. Right after the join the node may not
// hold its forums yet: the subgroup list comes back empty, and a forum can be
// listed before its context arrives. Neither is the space's real answer, so
// neither may settle the join-sync gate (which closes the invitation dialog
// onto "No forums yet"); the page re-reads until the forums land.

const h = vi.hoisted(() => {
  const node = {
    subgroups: [] as { groupId: string }[] | Error,
    contexts: {} as Record<string, { contextId: string }[]>,
  };
  const admin = {
    getNamespace: vi.fn(async () => ({ name: "Team" })),
    listNamespaceGroups: vi.fn(async () => {
      if (node.subgroups instanceof Error) throw node.subgroups;
      return node.subgroups;
    }),
    listGroupContexts: vi.fn(async (id: string) => node.contexts[id] ?? []),
    listGroupMembers: vi.fn(async () => ({ members: [] as unknown[] })),
    getGroupMetadata: vi.fn(async () => ({ name: "General" })),
    getContextIdentitiesOwned: vi.fn(async () => ({
      identities: [] as string[],
    })),
  };
  // Stable across renders, like the real provider's client.
  const session = { mero: { admin }, admin, logout: () => {}, nodeUrl: null };
  return { node, session };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => h.session,
  useNodeIdentity: () => ({ identity: null }),
}));

vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => ({
    appId: "app-1",
    resolving: false,
    notInstalled: false,
  }),
}));

import ForumsPage from "./ForumsPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/spaces/ns-1"]}>
      <Routes>
        <Route path="/spaces/:namespaceId" element={<ForumsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  h.node.subgroups = [];
  h.node.contexts = {};
  markNamespaceJustJoined("ns-1");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ForumsPage right after joining the space", () => {
  it("does not settle on an empty forum list, and re-reads until the forums arrive", async () => {
    renderPage();
    await advance(100);
    expect(screen.queryByTestId("forums-empty")).not.toBeInTheDocument();
    expect(isNamespaceJustJoined("ns-1")).toBe(true);

    h.node.subgroups = [{ groupId: "sub-a" }];
    h.node.contexts = { "sub-a": [{ contextId: "ctx-a" }] };
    await advance(2_500);

    expect(await screen.findByTestId("forum-row")).toBeEnabled();
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });

  it("retries a read that fails because the space has not synced yet", async () => {
    h.node.subgroups = new Error("namespace not found");
    renderPage();
    await advance(100);
    expect(isNamespaceJustJoined("ns-1")).toBe(true);

    h.node.subgroups = [{ groupId: "sub-a" }];
    h.node.contexts = { "sub-a": [{ contextId: "ctx-a" }] };
    await advance(2_500);

    expect(await screen.findByTestId("forum-row")).toBeEnabled();
  });

  it("re-reads a forum listed before its context arrived", async () => {
    h.node.subgroups = [{ groupId: "sub-a" }];
    renderPage();
    expect(await screen.findByTestId("forum-row")).toBeDisabled();

    h.node.contexts = { "sub-a": [{ contextId: "ctx-a" }] };
    await advance(2_500);

    expect(await screen.findByTestId("forum-row")).toBeEnabled();
  });

  it("shows a genuinely empty space as empty once the gate expires", async () => {
    renderPage();
    await advance(125_000);
    expect(await screen.findByTestId("forums-empty")).toBeInTheDocument();
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });
});
