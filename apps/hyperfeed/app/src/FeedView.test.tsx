import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { FeedView, type NewFeed } from "./FeedView";
import { DemoBackend } from "./demo";
import { useFeed, type Feed } from "./useFeed";
import type { FeedItem } from "./generated/HyperfeedClient";
import { subjectKey } from "./subject";

function Harness({
  backend,
  newFeed,
  openLink,
  people,
}: {
  backend: DemoBackend;
  newFeed?: NewFeed;
  openLink?: (item: FeedItem) => Promise<string | null>;
  people?: boolean;
}) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" newFeed={newFeed} openLink={openLink} people={people} />;
}

const stream = () => screen.getByRole("main");
const lane = (name: string) => screen.getByRole("region", { name });
const digest = () => lane("Your agent today");
const needs = () => lane("Needs you");

/** Open your agent's digest card into its chains. */
async function openDigest() {
  const show = await within(await screen.findByRole("region", { name: "Your agent today" })).findByRole("button", { name: /^Show/ });
  await act(async () => {
    fireEvent.click(show);
  });
}

const noRow: FeedItem = {
  id: "", kind: "notification", chain: "", chain_len: 1, chain_at: 0, app: "", source_context: "ctx", source_label: "", title: "", body: "",
  at: 0, needs_you: false, status: "received", status_at: 0, note: "", ask: { kind: "", prompt: "", options: [], draft: "" }, history: [],
  method: "", category: "", why: "", intent_hash: "", executor: "", undoable: false, breach: "", reviewed_at: 0, from: "", event: "",
  seen: true, reply_to: "", item_type: "", fields: "", reply_call: "", doing: "", doing_at: 0, attachments: [], steps: [], draft: "", stop_at: 0, headline: "", superseded_by: "", answers: "", answers_superseded: false, held_by: "", held_since: 0, subject: "",
};

/** A feed that only shows these rows. */
function staticFeed(items: FeedItem[]): Feed {
  return {
    page: { items, total: items.length, counts: { all: items.length, agent: 0, notifications: 0, needs_you: 0, archived: 0 } },
    filter: "all",
    error: "",
    busy: false,
    settings: null,
    toast: null,
    markSeen: async () => undefined,
    loadChain: async () => [],
  } as unknown as Feed;
}

/** A notification nothing is asked of: its chain leads with whatever your agent says in it last. */
const mention = (key: string) => ({
  key, app: "chat", source_context: "ctx", source_label: "#launch", from: "Maya", title: "Mentioned you", body: "How did the deploy go?",
  event: "MessageSent", needs_you: false, chain: "", ask: { kind: "", prompt: "", options: [], draft: "" }, item_type: "", fields: "", reply_call: "",
});

/** Your agent's own rows are folded into its digest: open it. */
async function showAgentRows() {
  const show = await screen.findByRole("button", { name: /Show it/ });
  await act(async () => {
    fireEvent.click(show);
  });
}

/** A chain's row, by its title: a task post may share it, but it is not a row. */
async function rowFor(title: RegExp) {
  const lines = await within(stream()).findAllByRole("button", { name: title });
  const rows = lines.map((l) => l.closest("li")).filter((li): li is HTMLLIElement => li !== null);
  if (rows.length !== 1) throw new Error(`${rows.length} rows match ${title}`);
  return rows[0]!;
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
  it("sorts chains into needs you, in progress and done", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await rowFor(/Vendor NDA/);
    expect(within(needs()).getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
    // Your agent's finished work is in its digest, not a lane.
    for (const name of ["Needs you", "In progress", "Done"]) {
      expect(within(lane(name)).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    }
    // Nothing is shown twice: no side panel repeats the row.
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });

  it("folds your agent's chains into one digest card, which opens into them", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await rowFor(/Vendor NDA/);
    // What needs you stays in the strip, and the card only counts it.
    expect(digest()).toHaveTextContent("Did 1 thing, 3 waiting on you.");
    expect(within(digest()).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    // After what needs you, before everything else.
    expect(needs().compareDocumentPosition(digest()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(digest().compareDocumentPosition(lane("In progress")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await openDigest();
    const row = await openRow(/Posted your stand-up/);
    expect(digest()).toContainElement(row);
    expect(within(row).getByRole("button", { name: /Archive/ })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(digest()).getByRole("button", { name: "Hide" }));
    });
    expect(within(digest()).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
  });

  it("sums up your agent's day as filed issues and what waits on you, with team rows left in the lanes", async () => {
    const at = Date.now();
    const issue = (id: string, title: string) => ({
      ...noRow, id, chain: id, kind: "action", app: "issue-tracker", method: "mero_issue_tracker_i_create_issue", status: "done", title, at, chain_at: at,
    });
    const items: FeedItem[] = [
      issue("a1", "Filed: Create my feed fails"),
      issue("a2", "Filed: Token expires in minutes"),
      { ...noRow, id: "m1", chain: "m1", kind: "message", from: "agent", status: "said", needs_you: true, title: "Delete the duplicate?", ask: { kind: "choose", prompt: "Delete it?", options: ["Delete", "Keep"], draft: "" }, at, chain_at: at },
      { ...noRow, id: "n1", chain: "n1", app: "issue-tracker", from: "Xabi", title: "Commented on your issue", at, chain_at: at },
    ];
    render(<FeedView feed={staticFeed(items)} query="" />);
    expect(digest()).toHaveTextContent("Your agent today");
    expect(digest()).toHaveTextContent("Filed 2 issues, 1 waiting on you.");
    expect(within(needs()).getByRole("button", { name: /Delete the duplicate/ })).toBeInTheDocument();
    expect(within(lane("Done")).getByRole("button", { name: /Commented on your issue/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filed:/ })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(digest()).getByRole("button", { name: "Show all 2" }));
    });
    expect(within(digest()).getAllByRole("button", { name: /Filed:/ })).toHaveLength(2);
    expect(within(digest()).queryByRole("button", { name: /Delete the duplicate/ })).not.toBeInTheDocument();
  });

  it("offers only Archive on a failure no retry can fix: a change only you can make, or a method that does not exist", async () => {
    const at = Date.now();
    const failed = (id: string, app: string, method: string, title: string, note: string) => ({
      ...noRow, id, chain: id, kind: "action", app, method, title, status: "failed", needs_you: true, at, chain_at: at, note,
    });
    const items: FeedItem[] = [
      failed("p1", "hyperfeed", "set_policy", "Set mero-bot to Act", "Only you can do this, in Hyperfeed's Controls"),
      failed("p2", "chat", "pin_message", "Pin the stand-up", 'FunctionCallError: method "pin_message" not found'),
      failed("p3", "chat", "send_message", "Post the stand-up", "the node did not answer"),
    ];
    render(<FeedView feed={staticFeed(items)} query="" />);
    // Right on the card, before it is opened: Archive, and nothing that leads nowhere.
    for (const title of [/Set mero-bot to Act/, /Pin the stand-up/]) {
      const card = await rowFor(title);
      expect(within(card).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(within(card).queryByRole("button", { name: "Decline" })).not.toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Archive" })).toBeInTheDocument();
    }
    const rule = await openRow(/Set mero-bot to Act/);
    expect(within(rule).getAllByRole("button", { name: /^Archive/ })).toHaveLength(1);
    expect(rule).toHaveTextContent("Retrying can't help");
    const pin = await openRow(/Pin the stand-up/);
    expect(pin).toHaveTextContent("Chat has no pin_message.");
    // A failure a retry can fix still offers one.
    const post = await openRow(/Post the stand-up/);
    expect(within(post).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(post).getByRole("button", { name: "Decline" })).toBeInTheDocument();
  });

  it("says a command on your computer in one line, with the command folded behind Details", async () => {
    const at = Date.now();
    const command = "$ export PATH=$HOME/.cargo/bin:$PATH\ncargo mero bundle --manifest-path logic/Cargo.toml";
    const items: FeedItem[] = [
      {
        ...noRow, id: "l1", chain: "l1", kind: "action", app: "mero-bot", source_label: "This computer", method: "Bash", status: "pending",
        needs_you: true, title: "Bundle the hyperfeed contract in apps-hyperfeed-images", body: command, at, chain_at: at,
      },
      { ...noRow, id: "c1", chain: "c1", kind: "action", app: "chat", method: "send_message", status: "pending", needs_you: true, title: "Post the stand-up", body: "Shipped the fold", at, chain_at: at },
    ];
    render(<FeedView feed={staticFeed(items)} query="" />);
    const row = await openRow(/Bundle the hyperfeed contract in apps-hyperfeed-images/);
    const details = within(row).getByText("Details").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("cargo mero bundle");
    expect(within(row).getByRole("button", { name: /Bundle the hyperfeed contract/ })).not.toHaveTextContent("cargo");
    // Any other row's body is shown as it is.
    const post = await openRow(/Post the stand-up/);
    expect(within(post).queryByText("Details")).not.toBeInTheDocument();
    expect(within(post).getByText("Shipped the fold")).toBeInTheDocument();
  });

  it("says an older row titled with a bare method in plain words", async () => {
    const at = Date.now();
    const items: FeedItem[] = [
      { ...noRow, id: "s1", chain: "s1", kind: "action", app: "issue-tracker", method: "set_summary", status: "pending", needs_you: true, title: "set summary in issue-tracker", at, chain_at: at },
    ];
    render(<FeedView feed={staticFeed(items)} query="" />);
    expect(await rowFor(/Set the summary in Issue Tracker/)).toBeInTheDocument();
  });

  it("titles a command in one line and folds the command behind Details", async () => {
    const at = Date.now();
    const command = "$ export PATH=$HOME/.cargo/bin:$PATH\ncargo mero bundle --manifest-path logic/Cargo.toml";
    const items: FeedItem[] = [
      {
        ...noRow, id: "l1", chain: "l1", kind: "action", app: "mero-bot", source_label: "This computer", method: "Bash", status: "pending",
        needs_you: true, title: "Bundle the hyperfeed contract in apps-hyperfeed-images", body: command, at, chain_at: at,
      },
      {
        ...noRow, id: "l2", chain: "l2", kind: "action", app: "issue-tracker", method: "set_summary", status: "pending",
        needs_you: true, title: "set summary in issue-tracker", body: "issue_id: 7", at, chain_at: at,
      },
    ];
    render(<FeedView feed={staticFeed(items)} query="" />);
    const row = await openRow(/Bundle the hyperfeed contract in apps-hyperfeed-images/);
    const details = within(row).getByText("Details").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("cargo mero bundle");
    expect(within(row).queryByText(command, { selector: "p" })).not.toBeInTheDocument();
    // An older row titled with the bare method is said in plain words.
    expect(await rowFor(/Set the summary in Issue Tracker/)).toBeInTheDocument();
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
    expect(await within(needs()).findByRole("button", { name: /Book 20 minutes with Maya/ })).toBeInTheDocument();
    const nda = (await backend.chain("chat-launch:e>f:0")).find((i) => /Vendor NDA/.test(i.title));
    expect(nda?.status).toBe("approved");
  });

  it("settles an assignment and a proposal from their cards, without opening either", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const nda = await rowFor(/Vendor NDA/);
    const assigned = await rowFor(/assigned HF-31 to you/);
    for (const card of [nda, assigned]) {
      expect(needs()).toContainElement(card);
      expect(within(card).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
    }
    expect(assigned).toHaveTextContent("Tomás Reid assigned HF-31 to you");
    await act(async () => {
      fireEvent.click(within(assigned).getByRole("button", { name: "Take it this sprint" }));
    });
    expect((await backend.chain("issues-ctx:a>b:0"))[0]).toMatchObject({ status: "answered", note: "Take it this sprint" });
    await act(async () => {
      fireEvent.click(within(nda).getByRole("button", { name: "Approve" }));
    });
    const proposal = (await backend.chain("chat-launch:e>f:0")).find((i) => /Vendor NDA/.test(i.title));
    expect(proposal?.status).toBe("approved");
  });

  it("opens a card for the rest, without showing its buttons a second time", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const card = await openRow(/Vendor NDA/);
    expect(within(card).getByRole("list", { name: "The whole flow" })).toBeInTheDocument();
    for (const name of [/Later/, /Archive/]) expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    const flow = within(card).getByRole("list", { name: "The whole flow" });
    expect(within(card).getAllByRole("button", { name: "Approve" }).filter((b) => !flow.contains(b))).toHaveLength(1);
  });

  it("says you're clear when nothing needs you", async () => {
    const at = Date.now();
    render(<FeedView feed={staticFeed([{ ...noRow, id: "n1", chain: "n1", app: "chat", from: "Maya", title: "Said hi", at, chain_at: at }])} query="" />);
    expect(needs()).toHaveTextContent("You're clear. Nothing is waiting on you.");
    expect(within(needs()).queryByRole("listitem")).not.toBeInTheDocument();
    expect(within(lane("Done")).getByRole("button", { name: /Said hi/ })).toBeInTheDocument();
  });

  it("moves a chain from In progress to Needs you when your reply in it fails to go out", async () => {
    const backend = new DemoBackend(false, 0);
    await backend.setPolicy("sheets", "act", "feed");
    const mention = await backend.recordNotification({
      key: "chat:m:0", app: "chat", source_context: "ctx", source_label: "#launch", from: "Maya", title: "Can you share the numbers?",
      body: "", event: "MessageSent", needs_you: true, chain: "", ask: { kind: "reply", prompt: "Reply in #launch", options: [], draft: "" },
      item_type: "", fields: "", reply_call: "",
    });
    await backend.answerNotification(mention.id, "Sharing them now");
    await backend.recordAction({
      app: "sheets", source_context: "ctx", source_label: "", method: "update", category: "", writes: true, undoable: false,
      title: "Pulled the numbers into a sheet", body: "", why: "", outcome: "done", intent_hash: "", executor: "", note: "",
      chain: mention.chain, ask: { kind: "", prompt: "", options: [], draft: "" }, grant: "", subject: "",
    });
    render(<Harness backend={backend} />);
    const row = await rowFor(/can you share the numbers/i);
    expect(lane("In progress")).toContainElement(row);

    // The reply fails to go out: the chain needs you, though the sheet step is done.
    await act(async () => {
      await backend.completeAnswer(mention.id, "failed", "The channel is read-only");
    });
    expect(needs()).toContainElement(await rowFor(/can you share the numbers/i));
  });

  it("keeps a chain in progress while something in it is still running, though a newer step is done", async () => {
    const backend = new DemoBackend(false, 0);
    await backend.setPolicy("sheets", "act", "feed");
    const mention = await backend.recordNotification({
      key: "chat:m:0", app: "chat", source_context: "ctx", source_label: "#launch", from: "Maya", title: "Can you send the numbers?",
      body: "", event: "MessageSent", needs_you: true, chain: "", ask: { kind: "reply", prompt: "Reply", options: [], draft: "" },
      item_type: "", fields: "", reply_call: "",
    });
    await backend.answerNotification(mention.id, "Sending them now");
    await backend.recordAction({
      app: "sheets", source_context: "", source_label: "", method: "update", category: "", writes: true, undoable: false,
      title: "Pulled the numbers into a sheet", body: "", why: "", outcome: "done", intent_hash: "", executor: "", note: "",
      chain: mention.id, ask: { kind: "", prompt: "", options: [], draft: "" }, grant: "", subject: "",
    });
    render(<Harness backend={backend} />);
    // Your reply is still being delivered: the chain is in progress, not done.
    const progress = await screen.findByRole("region", { name: "In progress" });
    expect(await within(progress).findByRole("button", { name: /Can you send the numbers/ })).toBeInTheDocument();
    expect(within(lane("Done")).queryByRole("button", { name: /Can you send the numbers/ })).not.toBeInTheDocument();
    await act(async () => {
      await backend.completeAnswer(mention.id, "delivered", "Sent");
    });
    // Everything in it settled: its latest row, your agent's, leads it out of In progress.
    await waitFor(() => expect(within(lane("In progress")).queryByRole("button", { name: /Can you send the numbers/ })).not.toBeInTheDocument());
    expect(digest()).toHaveTextContent("Did 1 thing");
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

  it("shows a long answer by its headline, with the whole body behind More", async () => {
    const backend = new DemoBackend(false, 0);
    const n = await backend.recordNotification(mention("k-ideas"));
    const body = `Here they are.\n${Array.from({ length: 300 }, (_, i) => `${i + 1}. An idea worth trying, with its reasons.`).join("\n")}`;
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(2_000);
    backend.agentSay(n.chain, "", body, undefined, "Ten ideas for the feed");
    render(<Harness backend={backend} />);
    await showAgentRows();
    const row = await openRow(/Ten ideas for the feed/);
    expect(row.querySelector(".row-title")).toHaveTextContent(/^Ten ideas for the feed$/);
    expect(within(row).queryByText(/300\. An idea worth trying/)).not.toBeInTheDocument();
    const more = within(row).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(more);
    });
    expect(within(row).getByText(/300\. An idea worth trying/)).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
  });

  it("titles an answer without a headline by its first sentence", async () => {
    const backend = new DemoBackend(false, 0);
    const n = await backend.recordNotification(mention("k-deploy"));
    backend.agentSay(n.chain, "", "The deploy is green and live on every node now. It took four minutes, and nothing failed.");
    render(<Harness backend={backend} />);
    await showAgentRows();
    const row = await openRow(/The deploy is green and live on every node now\./);
    expect(row.querySelector(".row-title")).toHaveTextContent(/^The deploy is green and live on every node now\.$/);
    expect(row.querySelector(".more-text")).toBeNull();
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "More" }));
    });
    expect(row.querySelector(".more-text")).toHaveTextContent(/It took four minutes, and nothing failed\.$/);
  });

  it("puts your agent's question in the strip, and one tap on an option answers it, unopened", async () => {
    const backend = new DemoBackend(false, 0);
    const q = await backend.say("", "Say hello in #calimero");
    backend.agentAsk(q.chain, q.id, "Posted. There are two hellos now: delete the duplicate?", {
      kind: "choose",
      prompt: "Delete the duplicate?",
      options: ["Delete the duplicate", "Keep both"],
      draft: "",
    });
    render(<Harness backend={backend} />);
    const row = await rowFor(/Posted\. There are two hellos now/);
    expect(needs()).toContainElement(row);
    // Who asks what, as a sentence, with the options right on the card.
    expect(row).toHaveTextContent("Your agent asks you");
    expect(within(row).getAllByText("Asks you").length).toBeGreaterThan(0);
    expect(within(row).getAllByRole("button")[0]).toHaveAttribute("aria-expanded", "false");
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: "Keep both" }));
    });
    const chain = await backend.chain(q.chain);
    expect(chain.at(-1)).toMatchObject({ from: "you", body: "Keep both", status: "waiting" });
    expect(chain.find((i) => i.status === "answered" && i.from === "agent")).toMatchObject({ note: "Keep both" });
    expect(within(needs()).queryByRole("button", { name: /two hellos/ })).not.toBeInTheDocument();
  });

  it("hides a replaced question's buttons and says a newer one replaced it", async () => {
    const backend = new DemoBackend(false, 0);
    const poll = await backend.recordNotification({
      ...mention("poll-1"),
      title: "Pick a slot",
      needs_you: true,
      ask: { kind: "choose", prompt: "Pick a slot", options: ["Tue", "Wed"], draft: "" },
    });
    backend.agentAsk(poll.chain, "", "Maya moved the meeting. Want me to pick Thu?", {
      kind: "choose",
      prompt: "Pick Thu?",
      options: ["Pick Thu", "Not now"],
      draft: "",
    });
    render(<Harness backend={backend} />);
    // One card waits on you: the newer question, with its buttons.
    const row = await rowFor(/Want me to pick Thu/);
    expect(needs()).toContainElement(row);
    expect(within(row).getByRole("button", { name: "Pick Thu" })).toBeInTheDocument();
    const open = await openRow(/Want me to pick Thu/);
    const flow = within(open).getByRole("list", { name: "The whole flow" });
    // The old poll is in the flow without its buttons, and says why.
    expect(within(flow).queryByRole("button", { name: "Tue" })).not.toBeInTheDocument();
    expect(within(flow).getByText("Replaced by a newer question")).toBeInTheDocument();
    expect((await backend.chain(poll.chain))[0]).toMatchObject({ needs_you: false, superseded_by: expect.any(String) });
  });

  it("shows a teammate's comment on an issue the task touched as a step of the task", async () => {
    const backend = new DemoBackend(false, 0);
    await backend.setPolicy("issue-tracker", "act", "feed");
    const blankAsk = { kind: "", prompt: "", options: [], draft: "" };
    const task = await backend.recordNotification({
      key: "mero-bot:task", app: "mero-bot", source_context: "", source_label: "", from: "", title: "Fix the sync bug",
      body: "", event: "Prompt", needs_you: false, chain: "", ask: blankAsk, item_type: "", fields: "", reply_call: "",
    });
    await backend.recordAction({
      app: "issue-tracker", source_context: "repo", source_label: "", method: "set_status", category: "", writes: true, undoable: false,
      title: "Moved the sync bug to In progress", body: "", why: "", outcome: "done", intent_hash: "", executor: "", note: "",
      chain: task.chain, ask: blankAsk, grant: "", subject: subjectKey("issue-tracker", "repo", "issue-7"),
    });
    const comment = await backend.recordNotification({
      key: "repo:a>b:0", app: "issue-tracker", source_context: "repo", source_label: "", from: "Xabi", title: "Commented on your issue Sync bug",
      body: "", event: "CommentAdded", needs_you: false, chain: "", ask: { kind: "reply", prompt: "Reply in the thread", options: [], draft: "" },
      item_type: "message", fields: JSON.stringify({ from: "Xabi", text: "Repro attached", where: "Sync bug", is_dm: false }),
      reply_call: JSON.stringify({ method: "add_comment", args: { issue_id: "issue-7", body: "=answer" } }),
    });
    expect(comment.chain).toBe(task.chain);
    render(<Harness backend={backend} />);
    // openRow insists on exactly one row: the task's, not one for the comment beside it.
    const row = await openRow(/commented on your issue Sync bug/i);
    const flow = within(row).getByRole("list", { name: "The whole flow" });
    expect(flow).toHaveTextContent("Moved the sync bug to In progress");
    expect(flow).toHaveTextContent(/commented on your issue Sync bug/i);
    expect((await backend.chain(task.chain)).map((i) => i.id)).toEqual(expect.arrayContaining([task.id, comment.id]));
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
    await openDigest();
    const row = await openRow(/Posted your stand-up/);
    await act(async () => {
      fireEvent.click(within(row).getByRole("button", { name: /Archive/ }));
    });
    expect(within(digest()).queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent("Archived");
    await act(async () => {
      fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    });
    expect(await within(digest()).findByRole("button", { name: /Posted your stand-up/ })).toBeInTheDocument();
  });

  it("archives everything done at once, your agent's too, and lists it under Archived", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await rowFor(/Vendor NDA/);
    // The stand-up, the one done chain, is your agent's.
    const done = 1;
    await act(async () => {
      fireEvent.click(within(lane("Done")).getByRole("button", { name: "Archive all done" }));
    });
    expect(await within(lane("Done")).findByText("Nothing finished yet.")).toBeInTheDocument();
    expect(within(digest()).queryByRole("button", { name: /^Show/ })).not.toBeInTheDocument();
    expect(within(needs()).getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
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
    expect(within(needs()).queryByRole("button", { name: /Vendor NDA/ })).not.toBeInTheDocument();
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
      return within(needs()).getByRole("button", { expanded: true });
    });
    const title = opened.textContent ?? "";
    await act(async () => {
      fireEvent.keyDown(window, { key: "e" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Archived");
    expect(within(needs()).queryByText(title.slice(0, 20))).not.toBeInTheDocument();
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

  it("asks the agent from the top of the feed and opens the new conversation in its digest", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await rowFor(/Vendor NDA/);
    const box = within(stream()).getByLabelText("Ask your agent");
    fireEvent.change(box, { target: { value: "What's left before the board meeting?" } });
    await act(async () => {
      fireEvent.click(within(stream()).getAllByRole("button", { name: "Send" })[0]!);
    });
    const row = await rowFor(/What's left before the board meeting/);
    expect(digest()).toContainElement(row);
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
    await openDigest();
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
  it("puts what you asked your agent on top as a task post, with its live step", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    await rowFor(/Vendor NDA/);
    const asked = await act(async () => backend.say("", "Fix the agent digest card"));
    await act(async () => {
      backend.agentAck(asked.id);
      backend.agentProgress(asked.id, "Running the tests in apps");
    });
    const tasks = await screen.findByRole("region", { name: "Your tasks" });
    const post = await within(tasks).findByRole("article", { name: "Fix the agent digest card" });
    await waitFor(() => expect(post).toHaveTextContent("Running the tests in apps"));
    expect(post).toHaveTextContent("Working");
    // On top: before anything that needs you.
    expect(tasks.compareDocumentPosition(needs()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It opens its chain in place.
    await act(async () => {
      fireEvent.click(within(post).getByRole("button", { name: /Fix the agent digest card/ }));
    });
    expect(await within(digest()).findByRole("button", { name: /Fix the agent digest card/, expanded: true })).toBeInTheDocument();
  });

  it("shows a task's links as chips: what teammates did there grouped under each, opened in its app, added and taken off by hand", async () => {
    const backend = new DemoBackend(false, 0);
    await backend.setPolicy("issue-tracker", "act", "feed");
    const opened: string[] = [];
    render(
      <Harness
        backend={backend}
        openLink={async (item) => {
          opened.push(`${item.app}:${item.source_context}`);
          return `https://example.test/${item.app}?context-id=${item.source_context}`;
        }}
      />,
    );
    const asked = await act(async () => backend.say("", "Fix the sync bug"));
    const blankAsk = { kind: "", prompt: "", options: [], draft: "" };
    await act(async () => {
      await backend.recordAction({
        app: "issue-tracker", source_context: "repo", source_label: "", method: "set_status", category: "", writes: true, undoable: false,
        title: "Moved the sync bug to In progress", body: "", why: "", outcome: "done", intent_hash: "", executor: "", note: "",
        chain: asked.chain, ask: blankAsk, grant: "", subject: subjectKey("issue-tracker", "repo", "issue-7"),
      });
      await backend.recordNotification({
        key: "repo:a>b:0", app: "issue-tracker", source_context: "repo", source_label: "", from: "Xabi Ortiz", title: "Commented on your issue Sync bug",
        body: "", event: "CommentAdded", needs_you: true, chain: "", ask: { kind: "reply", prompt: "Reply in the thread", options: [], draft: "" },
        item_type: "message", fields: JSON.stringify({ from: "Xabi Ortiz", text: "Repro attached", where: "Sync bug", is_dm: false }),
        reply_call: JSON.stringify({ method: "add_comment", args: { issue_id: "issue-7", body: "=answer" } }),
      });
    });
    const tasks = await screen.findByRole("region", { name: "Your tasks" });
    const post = await within(tasks).findByRole("article", { name: "Fix the sync bug" });
    const linked = await within(post).findByRole("group", { name: "Linked" });
    // The chip: the issue as a teammate's notification names it, and how much happened there.
    const chip = await within(linked).findByRole("button", { name: /Sync bug/, expanded: false });
    expect(within(chip).getByLabelText("1 from teammates")).toBeInTheDocument();

    // What teammates did there, grouped under the link, answerable in place.
    await act(async () => {
      fireEvent.click(chip);
    });
    const group = within(linked).getByRole("list", { name: "In Sync bug" });
    expect(group).toHaveTextContent("Xabi Ortiz");
    expect(group).toHaveTextContent("Repro attached");
    fireEvent.change(within(group).getByRole("textbox"), { target: { value: "Thanks, on it" } });
    await act(async () => {
      fireEvent.click(within(group).getByRole("button", { name: "Send" }));
    });
    await waitFor(() =>
      expect(backend.sent).toContainEqual(
        expect.objectContaining({ method: "add_comment", args: expect.objectContaining({ issue_id: "issue-7", body: "Thanks, on it" }) }),
      ),
    );

    // It opens in its app, beside the feed. (Answering re-renders the post: read it again.)
    const linkedNow = async () =>
      within(await within(screen.getByRole("region", { name: "Your tasks" })).findByRole("article", { name: "Fix the sync bug" })).getByRole("group", {
        name: "Linked",
      });
    await act(async () => {
      fireEvent.click(within(await linkedNow()).getByRole("button", { name: "Open Sync bug in Issue Tracker" }));
    });
    expect(opened).toEqual(["issue-tracker:repo"]);
    expect(await screen.findByRole("complementary", { name: /Issue Tracker/ })).toBeInTheDocument();

    // Linked by hand from its address, and taken off again.
    let linked2 = await linkedNow();
    await act(async () => {
      fireEvent.click(within(linked2).getByRole("button", { name: "+ Link" }));
    });
    linked2 = await linkedNow();
    fireEvent.change(within(linked2).getByLabelText("Link to add: an app's address"), {
      target: { value: "https://mero-chat-pwa.vercel.app/?context-id=launch" },
    });
    await act(async () => {
      fireEvent.click(within(linked2).getByRole("button", { name: "Add" }));
    });
    expect(await within(linked2).findByRole("button", { name: /^Chat/ })).toBeInTheDocument();
    expect((await backend.links(asked.chain)).map((l) => [l.subject, l.by])).toEqual([
      ["issue-tracker:repo:issue-7", "agent"],
      ["chat:launch", "you"],
    ]);
    await act(async () => {
      fireEvent.click(within(linked2).getByRole("button", { name: "Take Sync bug off the task" }));
    });
    await waitFor(() => expect(within(linked2).queryByRole("button", { name: /Sync bug/ })).not.toBeInTheDocument());
  });

  it("refuses a pasted link that is not one of your apps", async () => {
    const backend = new DemoBackend(false, 0);
    render(<Harness backend={backend} />);
    const asked = await act(async () => backend.say("", "Plan the offsite"));
    const post = await within(await screen.findByRole("region", { name: "Your tasks" })).findByRole("article", { name: "Plan the offsite" });
    const linked = within(post).getByRole("group", { name: "Linked" });
    await act(async () => {
      fireEvent.click(within(linked).getByRole("button", { name: "+ Link" }));
    });
    fireEvent.change(within(linked).getByLabelText("Link to add: an app's address"), { target: { value: "https://example.com/x" } });
    await act(async () => {
      fireEvent.click(within(linked).getByRole("button", { name: "Add" }));
    });
    expect(within(linked).getByText("Not an address of one of your apps")).toBeInTheDocument();
    expect(await backend.links(asked.chain)).toEqual([]);
  });

  describe("the new feed", () => {
    it("says each row as who did what", async () => {
      render(<Harness backend={new DemoBackend(true, 0)} people />);
      await rowFor(/Vendor NDA/);
      // A card in the strip: your agent, where, and what it wants to do.
      expect(await within(needs()).findByRole("button", { name: /Agent in Sign prepared "Vendor NDA/ })).toBeInTheDocument();
      expect(within(needs()).getByRole("button", { name: /Tomás Reid assigned HF-31 to you/ })).toBeInTheDocument();
      await openDigest();
      expect(await within(digest()).findByRole("button", { name: /Agent in Chat posted your stand-up/ })).toBeInTheDocument();
    });

    it("keeps your agent's answer in the chat thread, not as a row of its own", async () => {
      const backend = new DemoBackend(true, 0);
      render(<Harness backend={backend} people />);
      await rowFor(/Vendor NDA/);
      const asked = await act(async () => backend.say("", "What's left before the board meeting?"));
      await act(async () => {
        backend.agentSay(asked.chain, asked.id, "Two slides and the KPIs.");
      });
      await openDigest();
      const row = await rowFor(/You asked your agent What's left before the board meeting/);
      expect(row).toHaveTextContent("Agent replied");
      expect(row).toHaveTextContent("Answered");
      // The answer is not a row's headline: it is in the thread.
      expect(within(stream()).queryByRole("button", { name: /^Agent replied Two slides/ })).not.toBeInTheDocument();
      const open = await openRow(/You asked your agent What's left/);
      expect(await within(open).findByRole("list", { name: "The whole flow" })).toHaveTextContent("Two slides and the KPIs.");
    });

    it("leads with you when your decision was the last thing that happened", async () => {
      const at = Date.now();
      const items: FeedItem[] = [
        { ...noRow, id: "a1", chain: "a1", kind: "action", app: "calendar", status: "approved", title: "Book 20 minutes with Maya", at, chain_at: at },
      ];
      render(<FeedView feed={staticFeed(items)} query="" people />);
      await openDigest();
      expect(await within(digest()).findByRole("button", { name: /You approved Book 20 minutes with Maya/ })).toBeInTheDocument();
    });
  
    it("tells a task in milestones, on its post and in its chain, with the whole flow behind More", async () => {
      const backend = new DemoBackend(true, 0);
      render(<Harness backend={backend} people />);
      await rowFor(/Vendor NDA/);
      const asked = await act(async () => backend.say("", "Fix the digest card"));
      await act(async () => {
        backend.agentAck(asked.id);
        backend.agentSay(asked.chain, asked.id, "Opened PR #436; CI is green.");
      });
      const tasks = await screen.findByRole("region", { name: "Your tasks" });
      const post = await within(tasks).findByRole("article", { name: "Fix the digest card" });
      expect(await within(post).findByRole("list", { name: "Milestones: Filed → PR #436 → CI green → Done" })).toBeInTheDocument();

      await openDigest();
      const row = await openRow(/You asked your agent Fix the digest card/);
      expect(await within(row).findByRole("list", { name: "Milestones: Filed → PR #436 → CI green → Done" })).toBeInTheDocument();
      expect(within(row).queryByRole("list", { name: "The whole flow" })).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: "More" }));
      });
      expect(await within(row).findByRole("list", { name: "The whole flow" })).toHaveTextContent("Opened PR #436");
    });

    it("shows a chain with no story to tell as its flow, as before", async () => {
      render(<Harness backend={new DemoBackend(true, 0)} people />);
      await rowFor(/Vendor NDA/);
      const row = await openRow(/Vendor NDA/);
      expect(await within(row).findByRole("list", { name: "The whole flow" })).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    });
  });
});
