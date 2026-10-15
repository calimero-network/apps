import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";

// A company invitation lands on its audience list. Right after the join the
// node may not hold the company's audiences yet and the list reads empty. That
// is not the company's real answer, so it may not settle the join-sync gate
// (which closes the invitation dialog onto "No audiences yet"); the page
// re-reads the list until audiences land.

const h = vi.hoisted(() => {
  const node = { audiences: [] as Record<string, unknown>[] };
  const listAudiences = vi.fn(async () => node.audiences);
  // Stable across renders, like the real context.
  const admin = { getNamespace: async () => ({ name: "Acme" }) };
  return { node, listAudiences, admin };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin: h.admin, isDelegated: false }),
}));

vi.mock("../lib/groups", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listAudiences: h.listAudiences,
  namespaceTeeMode: async () => null,
}));

vi.mock("../contexts/ToastContext", () => ({
  useToast: () => ({ showToast: () => undefined }),
}));
vi.mock("../hooks/useApplicationId", () => ({
  useApplicationId: () => ({ appId: "app-1" }),
}));
vi.mock("../components/AppHeader", () => ({ default: () => null }));
vi.mock("../components/LogoutButton", () => ({ default: () => null }));
vi.mock("../components/InviteModal", () => ({ default: () => null }));

import AudiencesPage from "./AudiencesPage";

const AUDIENCE = {
  audienceId: "aud-1",
  name: "All investors",
  contextId: "ctx-1",
  memberCount: 1,
  teeMode: null,
  joined: false,
  identity: null,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/companies/ns-1"]}>
      <Routes>
        <Route path="/companies/:namespaceId" element={<AudiencesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  h.node.audiences = [];
  h.listAudiences.mockClear();
});

afterEach(() => {
  cleanup();
  clearNamespaceJustJoined("ns-1");
  vi.useRealTimers();
});

describe("AudiencesPage right after joining a company", () => {
  it("does not settle on an empty first list, and re-reads until audiences arrive", async () => {
    markNamespaceJustJoined("ns-1");
    renderPage();
    await advance(100);
    expect(h.listAudiences).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined("ns-1")).toBe(true);
    expect(screen.queryByTestId("audiences-empty")).not.toBeInTheDocument();

    h.node.audiences = [AUDIENCE];
    await advance(2_500);

    expect(h.listAudiences.mock.calls.length).toBeGreaterThan(1);
    expect(await screen.findByTestId("audience-row")).toHaveTextContent(
      "All investors",
    );
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });

  it("takes an empty list as the answer when nothing was just joined", async () => {
    renderPage();
    expect(await screen.findByTestId("audiences-empty")).toBeInTheDocument();
    await advance(5_000);
    expect(h.listAudiences).toHaveBeenCalledTimes(1);
  });
});
