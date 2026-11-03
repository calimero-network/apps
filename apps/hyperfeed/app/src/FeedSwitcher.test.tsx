import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CalimeroClient } from "@calimero-network/mero-js";
import { SessionContext, type SessionApi } from "./session";
import { FeedSwitcher } from "./FeedPicker";
import { openFeed, selectionKey, useOpenFeed } from "./newFeed";

/** What each feed holds: feed-bbbb has 39 rows. */
const pages: Record<string, { counts: { all: number; archived: number }; items: { chain_at: number }[] }> = {
  "feed-aaaa-1111": { counts: { all: 2, archived: 0 }, items: [{ chain_at: Date.now() }] },
  "feed-bbbb-2222": { counts: { all: 30, archived: 9 }, items: [{ chain_at: Date.now() - 5 * 60_000 }] },
};

/** The feeds on the cluster; feed-aaaa was renamed "My feed" in its metadata, feed-bbbb was made unnamed. */
const apps = [
  { appId: "feed-aaaa-1111", name: "", owner: "me", org: "org-a", bundle: "b1", package: "com.calimero.hyperfeed", version: "1" },
  { appId: "feed-bbbb-2222", name: "", owner: "me", org: "org-b", bundle: "b1", package: "com.calimero.hyperfeed", version: "1" },
];
const metadata: Record<string, Record<string, unknown>> = { "feed-aaaa-1111": { name: "My feed" } };
const deleted: string[] = [];
const made: string[] = [];

const client = {
  listApps: vi.fn(async () => apps.filter((a) => !deleted.includes(a.appId))),
  getApp: vi.fn(async (id: string) => ({ appId: id, metadata: metadata[id] ?? null })),
  setAppMetadata: vi.fn(async (id: string, m: Record<string, unknown>) => void (metadata[id] = m)),
  deleteApp: vi.fn(async (id: string) => void deleted.push(id)),
  createOrg: vi.fn(async (name: string) => (made.push(`org ${name}`), "org-new")),
  createApp: vi.fn(async (name: string, _source: unknown, options: { org?: string }) => {
    made.push(`app ${name} in ${options.org}`);
    return "feed-dddd-4444";
  }),
  view: vi.fn(async (app: string, method: string) => {
    expect(method).toBe("feed");
    return { index: 1, result: pages[app] ?? { counts: { all: 0, archived: 0 }, items: [] } };
  }),
} as unknown as CalimeroClient;

const api: SessionApi = {
  session: { status: "signed-in", client, target: { kind: "local", nodes: ["http://127.0.0.1:2501"] } as never, accountId: "me" },
  store: null,
  error: null,
  busy: false,
  signIn: async () => undefined,
  signUp: async () => undefined,
  signOut: async () => undefined,
};

/** What the app does: show the feed you opened, with the switcher. */
function Harness() {
  const current = useOpenFeed(api.session) ?? "feed-aaaa-1111";
  return (
    <>
      <FeedSwitcher current={current} />
      <main data-testid="open">{current}</main>
    </>
  );
}

const renderIt = () =>
  render(
    <SessionContext.Provider value={api}>
      <Harness />
    </SessionContext.Provider>,
  );

describe("Switching feeds", () => {
  it("lists your feeds by name and opens another in place, remembered for next time", async () => {
    renderIt();
    fireEvent.click(screen.getByTitle("Switch feed"));
    await waitFor(() => expect(screen.getAllByText("My feed")).toHaveLength(2));
    const items = screen.getAllByRole("menuitemradio");
    // Each by its name, with the short id as a hint; an unnamed one says so.
    expect(items[0]).toHaveTextContent(/^My feed · feed-aaa/);
    expect(items[1]).toHaveTextContent(/^Unnamed feed · feed-bbb/);
    expect(items[0]).toHaveAttribute("aria-checked", "true");

    fireEvent.click(items[1]!);
    expect(screen.getByTestId("open")).toHaveTextContent("feed-bbbb-2222");
    expect(localStorage.getItem(selectionKey(api.session.status === "signed-in" ? api.session.target : (null as never), "me"))).toBe("feed-bbbb-2222");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and offers a new feed", () => {
    renderIt();
    fireEvent.click(screen.getByTitle("Switch feed"));
    expect(screen.getByRole("menuitem", { name: "Create a new feed" })).toBeEnabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("says what each feed holds, and deletes another feed after a confirm", async () => {
    openFeed("feed-aaaa-1111");
    renderIt();
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
    expect(deleted).toEqual(["feed-bbbb-2222"]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    deleted.length = 0;
  });

  it("names a new feed as it is made: an organization of its own, then the feed in it", async () => {
    openFeed("feed-aaaa-1111");
    renderIt();
    await waitFor(() => expect(screen.getByTitle("Switch feed")).toHaveTextContent("My feed · feed-aaa"));
    fireEvent.click(screen.getByTitle("Switch feed"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Create a new feed" }));

    // "My feed" is taken: the next free one is offered.
    const form = screen.getByRole("group", { name: "Name your new feed" });
    const input = within(form).getByRole("textbox", { name: "Name" });
    await waitFor(() => expect(input).toHaveValue("My feed 2"));
    fireEvent.change(input, { target: { value: "   " } });
    expect(within(form).getByText("Give the feed a name.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Create" })).toBeDisabled();

    fireEvent.change(input, { target: { value: " Work " } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Create" }));
    });
    expect(made).toEqual(["org Work", "app Work in org-new"]);
    expect(screen.getByTestId("open")).toHaveTextContent("feed-dddd-4444");
  });

  it("renames an unnamed feed from the switcher, in its metadata", async () => {
    openFeed("feed-aaaa-1111");
    renderIt();
    fireEvent.click(screen.getByTitle("Switch feed"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename feed Unnamed feed · feed-bbb" }));
    const form = screen.getByRole("group", { name: "Rename feed Unnamed feed · feed-bbb" });
    const input = within(form).getByRole("textbox", { name: "Name" });
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "Side project" } });
    await act(async () => {
      fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    });
    expect(metadata["feed-bbbb-2222"]).toEqual({ name: "Side project" });
    await waitFor(() => expect(screen.getAllByRole("menuitemradio")[1]).toHaveTextContent(/^Side project · feed-bbb/));
  });
});
