import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { FeedView, type NewFeed } from "./FeedView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import type { FeedItem } from "./generated/HyperfeedClient";

function Harness({
  backend,
  newFeed,
  openLink,
}: {
  backend: DemoBackend;
  newFeed?: NewFeed;
  openLink?: (item: FeedItem) => Promise<string | null>;
}) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" newFeed={newFeed} openLink={openLink} />;
}

const stream = () => screen.getByRole("main");
const lane = (name: string) => screen.getByRole("region", { name });

/** A chain's row, by its title. */
async function rowFor(title: RegExp) {
  const line = await within(stream()).findByRole("button", { name: title });
  return line.closest("li")!;
}

/** Open a row in place, as clicking it does. */
async function openRow(title: RegExp) {
  const row = await rowFor(title);
  const line = within(row).getAllByRole("button")[0]!;
  if (line.getAttribute("aria-expanded") !== "true") {
    await act(async () => {
      fireEvent.click(line);
    });
  }
  return rowFor(title);
}

describe("FeedView", () => {
  it("sorts chains into to do, in progress and done", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await rowFor(/Vendor NDA/);
    expect(within(lane("To do")).getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
    expect(within(lane("Done")).getByRole("button", { name: /Posted your stand-up/ })).toBeInTheDocument();
    expect(within(lane("To do")).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    // Nothing is shown twice: no side panel repeats the row.
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("leads the #launch chain with the NDA; once approved, the next thing in the chain leads", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const row = await openRow(/Vendor NDA/);
    expect(within(row).getAllByText("Waiting for you").length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Approve" }));
    });
    // Same row (one per chain), now led by the slot proposal that still needs you.
    expect(await within(lane("To do")).findByRole("button", { name: /Book 20 minutes with Maya/ })).toBeInTheDocument();
    const nda = (await backend.chain("chat-launch:e>f:0")).find((i) => /Vendor NDA/.test(i.title));
    expect(nda?.status).toBe("approved");
  });

  it("puts Approve and Decline above a chain's flow, not after its whole history", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const row = await openRow(/Vendor NDA/);
    const flow = within(row).getByRole("list", { name: "The whole flow" });
    for (const name of ["Approve", "Decline"]) {
      const button = within(row).getAllByRole("button", { name }).find((b) => !flow.contains(b))!;
      expect(button.compareDocumentPosition(flow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("opens a chain's whole flow in place and settles a step from inside it", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const row = await openRow(/Vendor NDA/);
    const flow = within(row).getByRole("list", { name: "The whole flow" });
    const steps = within(flow).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("Maya Ortiz");
    expect(steps[0]).toHaveTextContent("Mentioned you");
    expect(flow).toHaveTextContent('Pulled 4 KPIs into "Q3 board deck"');
    await act(async () => {
      fireEvent.click(within(flow).getByRole("button", { name: "Today 13:15" }));
    });
    expect(await screen.findByText(/Picked "Today 13:15"/)).toBeInTheDocument();
  });

  it("replies to a message without leaving the feed", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const row = await openRow(/Vendor NDA/);
    const flow = within(row).getByRole("list", { name: "The whole flow" });
    fireEvent.click(within(flow).getByRole("button", { name: "After 2pm" }));
    expect(within(flow).getByLabelText("Reply in #launch")).toHaveValue("After 2pm");
    await act(async () => {
      fireEvent.click(within(flow).getByRole("button", { name: "Send" }));
    });
    expect(await screen.findByText("Replied to Maya Ortiz")).toBeInTheDocument();
    // A typed row is answered by the feed itself: straight into #launch, no agent turn.
    const [mention] = await backend.chain("chat-launch:e>f:0");
    expect(mention).toMatchObject({ status: "delivered", note: "Sent in #launch" });
    expect(backend.sent).toEqual([
      expect.objectContaining({ method: "send_message", args: expect.objectContaining({ message: "After 2pm" }) }),
    ]);
  });

  it("votes with one tap and edits a drafted reply before approving it", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const poll = await openRow(/Offsite location/);
    await act(async () => {
      fireEvent.click(within(poll).getByRole("button", { name: "Berlin" }));
    });
    expect(await screen.findByText('You chose "Berlin"')).toBeInTheDocument();

    const jordan = await openRow(/Reply to Jordan/);
    const box = within(jordan).getByLabelText("Send to Jordan");
    expect((box as HTMLTextAreaElement).value).toMatch(/^Hi Jordan/);
    fireEvent.change(box, { target: { value: "Hi Jordan, terms attached. Call Thursday?" } });
    await act(async () => {
      fireEvent.click(within(jordan).getByRole("button", { name: "Approve & send" }));
    });
    // The Northwind chain is now led by the CRM failure, the one thing left in it.
    expect(await within(stream()).findByRole("button", { name: /Couldn't move deal/ })).toBeInTheDocument();
    const reply = (await backend.chain("northwind")).find((i) => /Reply to Jordan/.test(i.title));
    expect(reply).toMatchObject({ status: "approved", note: "Hi Jordan, terms attached. Call Thursday?" });
  });

  it("archives a done chain, offers undo, and brings it back", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const row = await openRow(/Posted your stand-up/);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: /Archive/ }));
    });
    expect(within(lane("Done")).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Archived");
    await act(async () => {
      fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    });
    expect(await within(lane("Done")).findByRole("button", { name: /Posted your stand-up/ })).toBeInTheDocument();
  });

  it("archives everything done at once, and lists it under Archived", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await rowFor(/Posted your stand-up/);
    const done = within(lane("Done")).getAllByRole("listitem").length;
    await act(async () => {
      fireEvent.click(within(lane("Done")).getByRole("button", { name: "Archive all done" }));
    });
    expect(await within(lane("Done")).findByText("Nothing finished yet.")).toBeInTheDocument();
    expect(within(lane("To do")).getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Archived · \d+/ }));
    });
    const archived = await screen.findByRole("region", { name: "Archived" });
    expect(within(archived).getAllByRole("listitem").length).toBeGreaterThanOrEqual(done);
    const row = await openRow(/Posted your stand-up/);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Unarchive" }));
    });
    expect((await backend.feed("all", "")).items.some((i) => /Posted your stand-up/.test(i.title))).toBe(true);
  });

  it("puts a to-do away for later", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const row = await openRow(/Vendor NDA/);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: /Later/ }));
    });
    expect(within(lane("To do")).queryByRole("button", { name: /Vendor NDA/ })).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Back in 3 hours");
    expect((await backend.feed("archived", "")).items.some((i) => /Vendor NDA/.test(i.title))).toBe(true);
  });

  it("moves with J and K, and archives with E", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await rowFor(/Vendor NDA/);
    // J opens the first row. Pressed again until one is open: on a slow machine
    // the key handler can still be catching up with rows that just arrived.
    const opened = await waitFor(async () => {
      await act(async () => {
        fireEvent.keyDown(window, { key: "j" });
      });
      return within(lane("To do")).getByRole("button", { expanded: true });
    });
    const title = opened.textContent ?? "";
    await act(async () => {
      fireEvent.keyDown(window, { key: "e" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Archived");
    expect(within(lane("To do")).queryByText(title.slice(0, 20))).not.toBeInTheDocument();
  });

  it("opens a row in its app, beside the feed", async () => {
    const opened: string[] = [];
    render(
      <Harness
        backend={new DemoBackend(true, 0)}
        openLink={async (item) => {
          opened.push(item.app);
          return `https://example.test/${item.app}?context-id=${item.source_context}`;
        }}
      />,
    );
    const row = await openRow(/Vendor NDA/);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: /Open in Sign/ }));
    });
    const panel = await screen.findByRole("complementary", { name: /Sign/ });
    expect(within(panel).getByTitle(/Sign/)).toHaveAttribute("src", expect.stringContaining("https://example.test/sign"));
    // The app inside must be able to reach your node: Chrome's Local Network Access, passed on to the frame.
    const allow = within(panel).getByTitle(/Sign/).getAttribute("allow") ?? "";
    expect(allow).toMatch(/(^|;\s*)local-network-access(;|$)/);
    expect(allow).toMatch(/(^|;\s*)loopback-network(;|$)/);
    expect(within(panel).getByRole("link", { name: "Open in a tab" })).toHaveAttribute("target", "_blank");
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    });
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
    expect(opened).toEqual(["sign"]);
  });

  it("asks the agent from the top of the feed and opens the new conversation in progress", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await rowFor(/Vendor NDA/);
    const box = within(stream()).getByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "What's left before the board meeting?" } });
    await act(async () => {
      fireEvent.click(within(stream()).getAllByRole("button", { name: "Send" })[0]!);
    });
    const row = await rowFor(/What's left before the board meeting/);
    expect(lane("In progress")).toContainElement(row);
    expect(within(row).getByText("Sent · waiting for your agent")).toBeInTheDocument();
    expect(within(row).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "true");
    expect(box).toHaveValue("");
  });

  it("says why a message to your agent was not sent, and keeps your words", async () => {
    // What a node returns when the feed's contract predates talking to your agent.
    class NoSay extends DemoBackend {
      override async say(): Promise<never> {
        throw Object.assign(new Error("FunctionCallError"), { data: 'method "say" not found' });
      }
    }
    render(<Harness backend={new NoSay(true, 0)} />);
    await rowFor(/Vendor NDA/);
    const box = within(stream()).getByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "testing this" } });
    await act(async () => {
      fireEvent.click(within(stream()).getAllByRole("button", { name: "Send" })[0]!);
    });
    expect(box).toHaveValue("testing this");
    expect(await screen.findByRole("alert")).toHaveTextContent(/made by an earlier Hyperfeed/);
  });

  it("talks to the agent about a row, in its chain", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const row = await openRow(/Posted your stand-up/);
    fireEvent.change(within(row).getByLabelText("Talk to your agent about this"), {
      target: { value: "Mention the reconnect fix too" },
    });
    await act(async () => {
      fireEvent.click(within(row).getAllByRole("button", { name: "Send" }).at(-1)!);
    });
    const [standup] = (await backend.feed("all", "")).items.filter((i) => /Mention the reconnect/.test(i.title));
    expect(standup?.chain_len).toBe(2);
    const chain = await backend.chain(standup!.chain);
    expect(chain.map((i) => i.kind)).toEqual(["action", "message"]);
  });

  it("still shows a feed made before lenses, and says how to get them", async () => {
    // What a node returns when the feed's contract predates lenses.
    class OlderFeed extends DemoBackend {
      override async lenses(): Promise<never> {
        throw Object.assign(new Error("FunctionCallError"), { data: 'method "lenses" not found' });
      }
    }
    let created = 0;
    const newFeed = { create: async () => void created++, busy: false, failed: null };
    render(<Harness backend={new OlderFeed(true, 0)} newFeed={newFeed} />);
    expect(await rowFor(/Vendor NDA/)).toBeInTheDocument();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Your feed was made by an earlier Hyperfeed");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Create a new feed" }));
    expect(created).toBe(1);
  });
});
