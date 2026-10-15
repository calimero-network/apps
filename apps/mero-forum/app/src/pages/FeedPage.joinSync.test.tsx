import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  isNamespaceJustJoined,
  markNamespaceJustJoined,
} from "@calimero-network/mero-react";

// A forum invitation lands on the feed, so the feed is what ends the join-sync
// gate. Right after the join the node may not hold the forum's state yet: the
// first page comes back empty, or the read fails. Neither is the forum's real
// answer, so neither may settle the gate (which closes the invitation dialog
// onto an empty feed); the page re-reads the first page until posts land.

const h = vi.hoisted(() => {
  const node = { posts: [] as { id: string; title: string }[] | Error };
  // Stable across renders, like the memoised client.
  const client = {
    listPosts: vi.fn(async () => {
      if (node.posts instanceof Error) throw node.posts;
      return { items: node.posts, next_cursor: null };
    }),
  };
  return { node, client };
});

vi.mock("../lib/forum", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useForumClient: () => h.client,
  useSelfAccount: () => null,
}));

vi.mock("../lib/session", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveNamespaceId: () => "ns-1",
  getContextId: () => "ctx-1",
}));

vi.mock("../lib/nickname", () => ({ useNickname: () => ({ name: "me" }) }));
vi.mock("../components/Composer", () => ({ default: () => null }));
vi.mock("../components/NicknameBar", () => ({ default: () => null }));
vi.mock("../components/SessionMenu", () => ({ default: () => null }));
vi.mock("../components/PostCard", () => ({
  default: ({ post }: { post: { title: string } }) => (
    <div data-testid="post">{post.title}</div>
  ),
}));

import FeedPage from "./FeedPage";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/f"]}>
      <FeedPage />
    </MemoryRouter>,
  );
}

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  sessionStorage.clear();
  h.node.posts = [];
  markNamespaceJustJoined("ns-1");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("FeedPage right after joining the forum", () => {
  it("does not settle on an empty first page, and re-reads until posts arrive", async () => {
    renderPage();
    await advance(100);
    expect(screen.queryByText("No discussions yet")).not.toBeInTheDocument();
    expect(isNamespaceJustJoined("ns-1")).toBe(true);

    h.node.posts = [{ id: "p1", title: "Hello" }];
    await advance(2_500);

    expect(await screen.findByTestId("post")).toHaveTextContent("Hello");
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });

  it("retries a first read that fails because the forum has not synced yet", async () => {
    h.node.posts = new Error("context not found");
    renderPage();
    await advance(100);
    expect(isNamespaceJustJoined("ns-1")).toBe(true);

    h.node.posts = [{ id: "p1", title: "Hello" }];
    await advance(2_500);

    expect(await screen.findByTestId("post")).toHaveTextContent("Hello");
  });

  it("shows a genuinely empty forum as empty once the gate expires", async () => {
    renderPage();
    await advance(125_000);
    expect(await screen.findByText("No discussions yet")).toBeInTheDocument();
    expect(isNamespaceJustJoined("ns-1")).toBe(false);
  });
});
