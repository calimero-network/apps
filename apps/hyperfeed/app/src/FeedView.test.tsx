import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { FeedView, type NewFeed } from "./FeedView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";

function Harness({ backend, newFeed }: { backend: DemoBackend; newFeed?: NewFeed }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" newFeed={newFeed} />;
}

const stream = () => screen.getByRole("main");

async function cardFor(title: RegExp) {
  const button = await within(stream()).findByRole("button", { name: title });
  return button.closest("article")!;
}

describe("FeedView", () => {
  it("leads the #launch chain with the NDA; once approved, the next thing in the chain leads", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const card = await cardFor(/Vendor NDA/);
    expect(within(card).getByText("Waiting for you")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    });
    // Same row (one per chain), now led by the slot proposal that still needs you.
    expect(await within(card).findByRole("button", { name: /Book 20 minutes with Maya/ })).toBeInTheDocument();
    const nda = (await backend.chain("chat-launch:e>f:0")).find((i) => /Vendor NDA/.test(i.title));
    expect(nda?.status).toBe("approved");
  });

  it("expands a chain into its whole flow and settles a step from inside it", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const card = await cardFor(/Vendor NDA/);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Show the flow · 4 steps/ }));
    });
    const flow = await within(card).findByRole("list", { name: "The whole flow" });
    const steps = within(flow).getAllByRole("listitem");
    expect(steps[0]).toHaveTextContent("Maya Ortiz");
    expect(steps[0]).toHaveTextContent("Mentioned you");
    expect(flow).toHaveTextContent('Pulled 4 KPIs into "Q3 board deck"');
    // The slot proposal deeper in the chain is answered right there.
    await act(async () => {
      fireEvent.click(within(flow).getByRole("button", { name: "Today 13:15" }));
    });
    expect(await within(card).findByText(/Picked "Today 13:15"/)).toBeInTheDocument();
  });

  it("replies to a message without leaving the feed", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const card = await cardFor(/Vendor NDA/);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: /Show the flow/ }));
    });
    const flow = await within(card).findByRole("list", { name: "The whole flow" });
    fireEvent.click(within(flow).getByRole("button", { name: "After 2pm" }));
    expect(within(flow).getByLabelText("Reply in #launch")).toHaveValue("After 2pm");
    await act(async () => {
      fireEvent.click(within(flow).getByRole("button", { name: "Send" }));
    });
    expect(await within(flow).findByText("Replied to Maya Ortiz")).toBeInTheDocument();
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
    const poll = await cardFor(/Offsite location/);
    await act(async () => {
      fireEvent.click(within(poll).getByRole("button", { name: "Berlin" }));
    });
    expect(await within(poll).findByText('You chose "Berlin"')).toBeInTheDocument();

    const jordan = await cardFor(/Reply to Jordan/);
    const box = within(jordan).getByLabelText("Send to Jordan");
    expect((box as HTMLTextAreaElement).value).toMatch(/^Hi Jordan/);
    fireEvent.change(box, { target: { value: "Hi Jordan, terms attached. Call Thursday?" } });
    await act(async () => {
      fireEvent.click(within(jordan).getByRole("button", { name: "Approve & send" }));
    });
    // The Northwind chain is now led by the CRM failure, the one thing left in it.
    expect(await within(jordan).findByRole("button", { name: /Couldn't move deal/ })).toBeInTheDocument();
    const reply = (await backend.chain("northwind")).find((i) => /Reply to Jordan/.test(i.title));
    expect(reply).toMatchObject({ status: "approved", note: "Hi Jordan, terms attached. Call Thursday?" });
  });

  it("filters to what needs you", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await cardFor(/Vendor NDA/);
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Feed filters" })).getByRole("button", { name: /Needs you/ }));
    });
    expect(within(stream()).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    expect(within(stream()).getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
  });

  it("asks the agent from the top of the feed and opens the new conversation", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await cardFor(/Vendor NDA/);
    const box = within(stream()).getByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "What's left before the board meeting?" } });
    await act(async () => {
      fireEvent.click(within(stream()).getByRole("button", { name: "Send" }));
    });
    const card = await cardFor(/What's left before the board meeting/);
    expect(within(card).getByText("Sent · waiting for your agent")).toBeInTheDocument();
    expect(box).toHaveValue("");
    const detail = screen.getByRole("complementary", { name: "Selected item" });
    expect(within(detail).getByText("Conversation with your agent")).toBeInTheDocument();
  });

  it("says why a message to your agent was not sent, and keeps your words", async () => {
    // What a node returns when the feed's contract predates talking to your agent.
    class NoSay extends DemoBackend {
      override async say(): Promise<never> {
        throw Object.assign(new Error("FunctionCallError"), { data: 'method "say" not found' });
      }
    }
    render(<Harness backend={new NoSay(true, 0)} />);
    await cardFor(/Vendor NDA/);
    const box = within(stream()).getByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "testing this" } });
    await act(async () => {
      fireEvent.click(within(stream()).getByRole("button", { name: "Send" }));
    });
    expect(box).toHaveValue("testing this");
    expect(await screen.findByRole("alert")).toHaveTextContent(/made by an earlier Hyperfeed/);
  });

  it("talks to the agent about the selected row, in its chain", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const card = await cardFor(/Posted your stand-up/);
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Details" }));
    });
    const detail = screen.getByRole("complementary", { name: "Selected item" });
    fireEvent.change(within(detail).getByLabelText("Talk to your agent about this"), {
      target: { value: "Mention the reconnect fix too" },
    });
    await act(async () => {
      fireEvent.click(within(detail).getByRole("button", { name: "Send" }));
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
    expect(await cardFor(/Vendor NDA/)).toBeInTheDocument();
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Your feed was made by an earlier Hyperfeed");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(within(notice).getByRole("button", { name: "Create a new feed" }));
    expect(created).toBe(1);
  });
});

