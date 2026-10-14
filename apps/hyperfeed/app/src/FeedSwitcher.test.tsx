import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const setContextId = vi.fn();
const createNamespace = vi.fn(async (_r: { applicationId: string; name?: string }) => ({ namespaceId: "ns-new" }));
const createContext = vi.fn(async (_r: { groupId: string; name?: string }) => ({ contextId: "feed-dddd-4444" }));
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
  useCreateNamespace: () => ({ createNamespace }),
  useCreateContext: () => ({ createContext }),
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
/** Namespace names on the node: feed-aaaa's is "My feed", feed-bbbb's has none. */
const nsNames: Record<string, string | undefined> = { "ns-of-feed-aaaa-1111": "My feed" };
const named: string[] = [];
const admin = {
  getContextGroup: async (id: string) => `ns-of-${id}`,
  deleteContext: async (id: string) => void deleted.push(`context ${id}`),
  listGroupContexts: async () => [],
  deleteNamespace: async (id: string) => void deleted.push(`namespace ${id}`),
  getContextsForApplication: async () => ({
    contexts: ["feed-aaaa-1111", "feed-bbbb-2222"].map((id) => ({ id, groupId: `ns-of-${id}` })),
  }),
  listNamespacesForApplication: async () => Object.entries(nsNames).map(([namespaceId, name]) => ({ namespaceId, name })),
  getGroupMetadata: async () => null,
  setGroupMetadata: async (g: string, r: { name?: string }) => {
    nsNames[g] = r.name;
    named.push(`namespace ${g} ${r.name}`);
  },
  getContextMetadata: async () => null,
  setContextMetadata: async (_g: string, c: string, r: { name?: string }) => void named.push(`context ${c} ${r.name}`),
};
session.admin = admin;

const { FeedSwitcher } = await import("./FeedPicker");
const { openFeed, useOpenFeed } = await import("./newFeed");

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
  it("lists your feeds by name and opens another in place, remembered for next time", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTitle("Switch feed"));
    await waitFor(() => expect(screen.getAllByText("My feed")).toHaveLength(2));
    const items = screen.getAllByRole("menuitemradio");
    // Each by its name, with the short id as a hint; an unnamed one says so.
    expect(items[0]).toHaveTextContent(/^My feed · feed-aaa/);
    expect(items[1]).toHaveTextContent(/^Unnamed feed · feed-bbb/);
    expect(items[0]).toHaveTextContent("Open");
    expect(items[0]).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/chat-ccc/)).toBeNull();

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
    await waitFor(() => expect(screen.getByText("Unnamed feed")).toBeInTheDocument());
    // The open feed can't be deleted from here.
    expect(screen.queryByRole("menuitem", { name: "Delete feed My feed · feed-aaa" })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete feed Unnamed feed · feed-bbb" }));
    const confirm = screen.getByRole("alertdialog");
    expect(confirm).toHaveTextContent("Delete this feed and its 39 rows? This can't be undone.");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(deleted).toEqual([]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Delete feed Unnamed feed · feed-bbb" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    });
    expect(deleted).toEqual(["context feed-bbbb-2222", "namespace ns-of-feed-bbbb-2222"]);
    expect(refetch).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks Calimero Desktop to delete a feed when the node refuses this session", async () => {
    openFeed("feed-aaaa-1111");
    deleted.length = 0;
    const invoke = vi.fn(async () => undefined);
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
    const deleteContext = admin.deleteContext;
    admin.deleteContext = async () => {
      throw Object.assign(new Error("HTTP 403 Forbidden"), { status: 403 });
    };
    try {
      render(<Harness />);
      fireEvent.click(screen.getByTitle("Switch feed"));
      await waitFor(() => expect(screen.getByText("Unnamed feed")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete feed Unnamed feed · feed-bbb" }));
      await act(async () => {
        fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
      });

      expect(invoke).toHaveBeenCalledWith("plugin:event|emit", {
        event: "app-deep-link",
        payload: { slug: "com.calimero.hyperfeed", action: "delete-context", params: "context=feed-bbbb-2222" },
      });
      expect(screen.getByRole("status")).toHaveTextContent("Confirm in Calimero Desktop to finish.");
      // Not an error: nothing failed, the desktop has it now.
      expect(screen.queryByText("HTTP 403 Forbidden")).toBeNull();
      expect(deleted).toEqual([]);
    } finally {
      admin.deleteContext = deleteContext;
      delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  });

  it("names a new feed as it is made, on its namespace and its context", async () => {
    openFeed("feed-aaaa-1111");
    render(<Harness />);
    // The header names the open feed, with its short id as a hint.
    await waitFor(() => expect(screen.getByTitle("Switch feed")).toHaveTextContent("My feed · feed-aaa"));
    fireEvent.click(screen.getByTitle("Switch feed"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create a new feed" }));

    // "My feed" is taken: the next free one is offered.
    const form = screen.getByRole("group", { name: "Name your new feed" });
    const input = within(form).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("My feed 2");
    fireEvent.change(input, { target: { value: "   " } });
    expect(within(form).getByText("Give the feed a name.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Create" })).toBeDisabled();

    fireEvent.change(input, { target: { value: " Work " } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    });
    expect(createNamespace).toHaveBeenCalledWith({ applicationId: "hf", name: "Work" });
    expect(createContext).toHaveBeenCalledWith(expect.objectContaining({ groupId: "ns-new", name: "Work" }));
    expect(screen.getByTestId("open")).toHaveTextContent("feed-dddd-4444");
    expect(screen.queryByRole("group", { name: "Name your new feed" })).toBeNull();
  });

  it("renames an unnamed feed from the switcher", async () => {
    openFeed("feed-aaaa-1111");
    render(<Harness />);
    fireEvent.click(screen.getByTitle("Switch feed"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename feed Unnamed feed · feed-bbb" }));
    const form = screen.getByRole("group", { name: "Rename feed Unnamed feed · feed-bbb" });
    const input = within(form).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "Side project" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    });
    expect(named).toEqual(["namespace ns-of-feed-bbbb-2222 Side project", "context feed-bbbb-2222 Side project"]);
    await waitFor(() => expect(screen.getAllByRole("menuitemradio")[1]).toHaveTextContent(/^Side project · feed-bbb/));
    expect(screen.queryByText("Unnamed feed")).toBeNull();
  });
});
