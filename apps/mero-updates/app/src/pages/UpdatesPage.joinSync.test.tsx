import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";

// An audience invitation lands on the updates feed, so the feed is what ends
// the join-sync gate. Right after the join the node may not hold the audience's
// state yet and the feed reads empty. That is not the audience's real answer,
// so it may not settle the gate (which closes the invitation dialog onto an
// empty feed); the page re-reads the feed until updates land.

const h = vi.hoisted(() => {
  const node = { posts: [] as Record<string, unknown>[] };
  const listPosts = vi.fn(async () => ({
    items: node.posts,
    next_cursor: null,
  }));
  // Stable across renders, like the real context: a new one each render would
  // rebuild the client and re-read forever.
  const mero = {};
  const admin = {
    getContextIdentitiesOwned: async () => ({ identities: ["me"] }),
  };
  return { node, listPosts, mero, admin };
});

vi.mock("@calimero-network/mero-react", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ mero: h.mero, admin: h.admin }),
}));

vi.mock("@calimero-apps/names", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMemberNames: () => ({ nameOf: () => undefined }),
}));

vi.mock("../generated/UpdatesClient", () => ({
  UpdatesClient: class {
    listPosts = h.listPosts;
  },
}));

vi.mock("../lib/session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveNamespaceId: () => "ns-1",
  getContextId: () => "ctx-1",
}));

vi.mock("../components/AudienceShell", () => ({
  useAudience: () => ({
    me: { is_team: false },
    overview: null,
    categories: [],
  }),
}));

import UpdatesPage from "./UpdatesPage";

const POST = {
  id: "p1",
  title: "Q3 update",
  summary: "",
  author: "a".repeat(64),
  author_name: "Ana",
  author_is_team: true,
  created_at: 1,
  category_id: null,
  read_by_me: true,
  reactions: [],
  metric_count: 0,
  open_ask_count: 0,
  comment_count: 0,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/a"]}>
      <UpdatesPage />
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  sessionStorage.clear();
  h.node.posts = [];
  h.listPosts.mockClear();
});

afterEach(() => {
  cleanup();
  clearNamespaceJustJoined("ns-1");
  vi.useRealTimers();
});

describe("UpdatesPage right after joining an audience", () => {
  it("does not settle on an empty first read, and re-reads until updates arrive", async () => {
    markNamespaceJustJoined("ns-1");
    renderPage();
    await advance(100);
    expect(h.listPosts).toHaveBeenCalledTimes(1);
    expect(isNamespaceJustJoined("ns-1")).toBe(true);

    h.node.posts = [POST];
    await advance(2_500);

    expect(h.listPosts.mock.calls.length).toBeGreaterThan(1);
    expect(await screen.findByTestId("update-row")).toHaveTextContent(
      "Q3 update",
    );
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });

  it("takes an empty feed as the answer when nothing was just joined", async () => {
    renderPage();
    expect(await screen.findByText("No updates yet.")).toBeInTheDocument();
    await advance(5_000);
    expect(h.listPosts).toHaveBeenCalledTimes(1);
  });
});
