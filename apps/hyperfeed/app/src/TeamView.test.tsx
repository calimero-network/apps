import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { TeamView } from "./TeamView";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import type { FeedItem } from "./generated/HyperfeedClient";

function Harness({
  backend,
  onChat,
  focus,
  onFocused,
}: {
  backend: DemoBackend;
  onChat?: (chain: string) => void;
  focus?: string;
  onFocused?: () => void;
}) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <TeamView feed={feed} query="" onChat={onChat} focus={focus} onFocused={onFocused} />;
}

const region = (name: string) => screen.getByRole("region", { name });

const noRow: FeedItem = {
  id: "", kind: "notification", chain: "", chain_len: 1, chain_at: 0, app: "", source_context: "ctx", source_label: "", title: "", body: "",
  at: 0, needs_you: false, status: "received", status_at: 0, note: "", ask: { kind: "", prompt: "", options: [], draft: "" }, history: [],
  method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false, breach: "", reviewed_at: 0, from: "", event: "",
  seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0, attachments: [], steps: [], draft: "", stop_at: 0, headline: "", mode: "", superseded_by: "", answers: "", answers_superseded: false, held_by: "", held_since: 0, subject: "",
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
    expect(within(agent).getByText(/^(Filed|Did|Answered|\d+ in progress|\d+ failed|Nothing yet)/)).toBeInTheDocument();
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

  it("opens a conversation about a card in place, not in Chat", async () => {
    const opened: string[] = [];
    render(<Harness backend={new DemoBackend(true, 0)} onChat={(c) => opened.push(c)} />);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const card = within(needs).getByText("Tomás Reid").closest("li")!;
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Discuss" }));
    });
    const panel = region("Open conversation");
    expect(panel).toHaveTextContent("Tomás Reid");
    expect(within(panel).getByLabelText("Talk to your agent about this")).toBeInTheDocument();
    // Its card below already settles it: the panel does not offer the same answer again.
    expect(within(panel).queryByRole("button", { name: "Take it this sprint" })).not.toBeInTheDocument();
    expect(opened).toEqual([]);
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Open conversation" })).not.toBeInTheDocument();
  });

  it("opens what you ask your agent in place, with its turn and Open chat", async () => {
    const backend = new DemoBackend(false, 0);
    const opened: string[] = [];
    render(<Harness backend={backend} onChat={(c) => opened.push(c)} />);
    const box = await screen.findByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "Refactor everything" } });
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Send" })[0]!);
    });
    const panel = await screen.findByRole("region", { name: "Open conversation" });
    expect(panel).toHaveTextContent("Refactor everything");
    const [asked] = (await backend.feed("agent", "")).items;
    await act(async () => {
      backend.agentAck(asked!.id);
      backend.agentWork(asked!.id, [{ id: "t1", title: "Reading the repo", status: "running", at: Date.now() }]);
    });
    expect(await within(panel).findByText(/Reading the repo/)).toBeInTheDocument();
    expect(within(panel).queryByText("Your agent is on it")).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Stop" })).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole("button", { name: "Open chat" }));
    expect(opened).toEqual([asked!.chain]);
  });

  it("opens the row the bell points at, in Team", async () => {
    const backend = new DemoBackend(false, 0);
    const q = await backend.say("", "Clean up #calimero");
    backend.agentAsk(q.chain, q.id, "Two hellos there. Delete one?", { kind: "choose", prompt: "Delete one?", options: ["Delete it", "Keep both"], draft: "" });
    let focused = 0;
    render(<Harness backend={backend} focus={q.chain} onFocused={() => focused++} />);
    const panel = await screen.findByRole("region", { name: "Open conversation" });
    expect(panel).toHaveTextContent("Two hellos there");
    expect(focused).toBe(1);
  });

  it("opens one of your agent's chains from its card in place", async () => {
    const backend = new DemoBackend(false, 0);
    const q = await backend.say("", "Plan the offsite");
    backend.agentSay(q.chain, q.id, "Lisbon, two days, 14 people.");
    render(<Harness backend={backend} />);
    const agent = await screen.findByRole("region", { name: "Your agent today" });
    fireEvent.click(within(agent).getByRole("button", { name: /^See all/ }));
    await act(async () => {
      fireEvent.click(within(agent).getAllByRole("button").find((b) => /Lisbon|offsite/.test(b.textContent ?? ""))!);
    });
    expect(region("Open conversation")).toHaveTextContent(/Lisbon|offsite/);
  });
});
