import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { TeamView } from "./TeamView";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import type { FeedItem } from "./generated/HyperfeedClient";

function Harness({ backend, onChat }: { backend: DemoBackend; onChat?: (chain: string) => void }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <TeamView feed={feed} query="" onChat={onChat} />;
}

const region = (name: string) => screen.getByRole("region", { name });

const noRow: FeedItem = {
  id: "", kind: "notification", chain: "", chain_len: 1, chain_at: 0, app: "", source_context: "ctx", source_label: "", title: "", body: "",
  at: 0, needs_you: false, status: "received", status_at: 0, note: "", ask: { kind: "", prompt: "", options: [], draft: "" }, history: [],
  method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false, breach: "", reviewed_at: 0, from: "", event: "",
  seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0,
};

describe("TeamView", () => {
  it("puts what needs you on top, as people doing things, with its buttons on the card", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const card = within(needs).getByText("Tomás Reid").closest("li")!;
    expect(card).toHaveTextContent("Tomás Reid assigned HF-31 to you");
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Take it this sprint" }));
    });
    const [assigned] = await backend.chain("issues-ctx:a>b:0");
    expect(assigned).toMatchObject({ status: "answered", note: "Take it this sprint" });
  });

  it("shows your team's activity apart from your agent's, which is one digest card", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await screen.findByRole("region", { name: "Needs you" });
    const around = region("Around you");
    expect(within(around).queryByText(/Your agent/)).not.toBeInTheDocument();
    const agent = region("Your agent today");
    expect(within(agent).getByText(/^(Did|Answered|\d+ in progress|\d+ failed|Nothing yet)/)).toBeInTheDocument();
  });

  it("shows two teammates' comments on one issue as one card, below Needs you, with both faces and the latest verb", () => {
    const at = Date.now();
    const said = (id: string, from: string, text: string, ago: number) => ({
      ...noRow,
      id,
      chain: id,
      kind: "notification",
      app: "issue-tracker",
      title: "Commented on your issue",
      item_type: "message",
      fields: JSON.stringify({ from, text, where: "Issue: Create my feed fails", is_dm: false }),
      at: at - ago,
      chain_at: at - ago,
    });
    const items = [said("n1", "Xabi", "Seen it on rc.83 too.", 2_000), said("n2", "Maya", "Context step fails.", 1_000)];
    const feed = { page: { items, total: items.length }, error: "", busy: false, settings: null } as unknown as Feed;
    render(<TeamView feed={feed} query="" />);
    const around = region("Around you");
    const cards = within(around).getAllByRole("listitem");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Maya and Xabi commented on your issue");
    expect(cards[0]).toHaveTextContent("Issue: Create my feed fails");
    expect(within(cards[0]!).getByTitle("Maya")).toBeInTheDocument();
    expect(within(cards[0]!).getByTitle("Xabi")).toBeInTheDocument();
    // The team feed comes after what needs you.
    expect(region("Needs you").compareDocumentPosition(around) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says you are clear when nothing needs you", async () => {
    render(<Harness backend={new DemoBackend(false, 0)} />);
    expect(await screen.findByText("You're clear. Nothing is waiting on you.")).toBeInTheDocument();
    expect(within(region("Your agent today")).getByText("Nothing yet today.")).toBeInTheDocument();
  });

  it("opens a conversation about a card in the chat", async () => {
    const opened: string[] = [];
    render(<Harness backend={new DemoBackend(true, 0)} onChat={(c) => opened.push(c)} />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const card = within(needs).getByText("Tomás Reid").closest("li")!;
    fireEvent.click(within(card).getByRole("button", { name: "Discuss" }));
    expect(opened).toEqual(["issues-ctx:a>b:0"]);
  });
});
