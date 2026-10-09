import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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
}));

const { FeedSwitcher } = await import("./FeedPicker");
const { useOpenFeed } = await import("./newFeed");
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
    expect(items.map((i) => i.textContent)).toEqual([`${short("feed-aaaa-1111")}Open`, short("feed-bbbb-2222")]);
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
});
