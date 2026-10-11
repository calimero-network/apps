import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const setContextId = vi.fn();
const refetch = vi.fn(async () => undefined);
vi.mock("@calimero-network/mero-react", () => ({
  setContextId: (id: string) => setContextId(id),
  useApplicationContexts: () => ({
    contexts: [
      { contextId: "feed-aaaa-1111", applicationId: "hf" },
      { contextId: "feed-bbbb-2222", applicationId: "hf" },
      // Another app's context is never offered as a feed.
      { contextId: "chat-cccc-3333", applicationId: "chat" },
    ],
    loading: false,
    error: null,
    refetch,
  }),
  useCreateNamespace: () => ({ createNamespace: vi.fn() }),
  useCreateContext: () => ({ createContext: vi.fn() }),
  // One client, as the real hook keeps: a new one each render re-reads the feeds.
  useMero: () => session,
}));

/** What each feed holds: feed-bbbb has 39 rows, feed-cccc none. */
const pages: Record<string, { counts: { all: number; archived: number }; items: { chain_at: number }[] }> = {
  "feed-aaaa-1111": { counts: { all: 2, archived: 0 }, items: [{ chain_at: Date.now() }] },
  "feed-bbbb-2222": { counts: { all: 30, archived: 9 }, items: [{ chain_at: Date.now() - 5 * 60_000 }] },
};
vi.mock("./generated/HyperfeedClient", () => ({
  HyperfeedClient: class {
    constructor(
      _mero: unknown,
      private id: string,
    ) {}
    feed() {
      return Promise.resolve(pages[this.id] ?? { counts: { all: 0, archived: 0 }, items: [] });
    }
  },
}));

const deleted: string[] = [];
const session = { mero: {}, admin: null as unknown };
const admin = {
  getContextGroup: async (id: string) => `ns-of-${id}`,
  deleteContext: async (id: string) => void deleted.push(`context ${id}`),
  listGroupContexts: async () => [],
  deleteNamespace: async (id: string) => void deleted.push(`namespace ${id}`),
};
session.admin = admin;

const { FeedSwitcher } = await import("./FeedPicker");
const { openFeed, useOpenFeed } = await import("./newFeed");
const { short } = await import("./format");

/** What the app does: show the feed you opened, else the session's, with the switcher. */
function Harness() {
  const current = useOpenFeed("feed-aaaa-1111")!;
  return (
    <>
      <FeedSwitcher applicationId="hf" current={current} />
      <main data-testid="open">{current}</main>
    </>
  );
}

describe("Switching feeds", () => {
  it("lists your feeds and opens another in place, remembered for next time", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle("Switch feed"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent?.startsWith(short(i.textContent.includes("Open") ? "feed-aaaa-1111" : "feed-bbbb-2222")))).toEqual([true, true]);
    expect(items[0]).toHaveTextContent("Open");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(short("chat-cccc-3333"))).toBeNull();

    fireEvent.click(items[1]!);
    expect(screen.getByTestId("open")).toHaveTextContent("feed-bbbb-2222");
    expect(setContextId).toHaveBeenCalledWith("feed-bbbb-2222");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and offers a new feed", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle("Switch feed"));
    expect(screen.getByRole("menuitem", { name: "Create a new feed" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says what each feed holds, and deletes another feed with its namespace after a confirm", async () => {
    // The feed opened in this tab outlives a test: start from feed-aaaa.
    openFeed("feed-aaaa-1111");
    render(<Harness />);
    fireEvent.click(screen.getByTitle("Switch feed"));
    await waitFor(() => expect(screen.getByText("39 rows · 5 min")).toBeInTheDocument());
    // The open feed can't be deleted from here.
    expect(screen.queryByRole("menuitem", { name: `Delete feed ${short("feed-aaaa-1111")}` })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: `Delete feed ${short("feed-bbbb-2222")}` }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete this feed and its 39 rows? This can't be undone.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(deleted).toEqual([]);

    fireEvent.click(screen.getByRole("menuitem", { name: `Delete feed ${short("feed-bbbb-2222")}` }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    });
    expect(deleted).toEqual(["context feed-bbbb-2222", "namespace ns-of-feed-bbbb-2222"]);
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
