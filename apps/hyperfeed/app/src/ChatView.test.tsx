import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ChatView, UNANSWERED_MS } from "./ChatView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";

function Harness({ backend, start = "", clock }: { backend: DemoBackend; start?: string; clock?: () => number }) {
  const [nudge, setNudge] = useState(0);
  const [chain, setChain] = useState(start);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <ChatView feed={feed} chain={chain} onOpen={setChain} clock={clock} />;
}

const thread = () => screen.getByRole("log");
const list = () => screen.getByRole("navigation", { name: "Chats" });

async function say(text: string) {
  fireEvent.change(screen.getByLabelText("Message your agent"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  });
}

describe("chat with your agent", () => {
  it("starts a chat, keeps it going, and shows your agent's answers", async () => {
    const backend = new DemoBackend(false, 0);
    render(<Harness backend={backend} />);
    expect(await within(list()).findByText(/No chats yet/)).toBeInTheDocument();

    await say("Draft the launch post");
    expect(await within(thread()).findByText("Draft the launch post")).toBeInTheDocument();
    expect(within(thread()).getByText("Sent · waiting for your agent")).toBeInTheDocument();
    expect(screen.getByLabelText("Message your agent")).toHaveValue("");

    // Your agent, as mero-bot does it: takes the message up, then answers in its chain.
    const [asked] = await backend.chain((await backend.feed("agent", "")).items[0]!.chain);
    await act(async () => void backend.agentAck(asked!.id));
    expect(await within(thread()).findByText("Your agent is on it…")).toBeInTheDocument();
    await act(async () => void backend.agentSay(asked!.chain, asked!.id, "Here is a first draft."));
    expect(await within(thread()).findByText("Here is a first draft.")).toBeInTheDocument();

    // A follow-up joins the same chat.
    await say("Shorter, please");
    expect(await within(thread()).findByText("Shorter, please")).toBeInTheDocument();
    expect(await backend.chain(asked!.chain)).toHaveLength(3);
    expect(within(list()).getAllByRole("button", { name: /Shorter, please/ })).toHaveLength(1);
  });

  it("asks whether your agent is running when nothing picks your message up", async () => {
    let now = Date.now();
    const backend = new DemoBackend(false, 0, () => now);
    const fresh = await backend.say("", "Anyone there?");
    const { unmount } = render(<Harness backend={backend} start={fresh.chain} clock={() => now} />);
    expect(await screen.findByText("Sent · waiting for your agent")).toBeInTheDocument();
    unmount();
    now += UNANSWERED_MS + 1_000;
    render(<Harness backend={backend} start={fresh.chain} clock={() => now} />);
    expect(await screen.findByText(/Is mero-bot running against this feed\?/)).toBeInTheDocument();
  });

  it("hides finished chats until you ask for them, but never the one you have open", async () => {
    const backend = new DemoBackend(false, 0);
    const finished = await backend.say("", "What time is it in Tokyo?");
    backend.agentSay(finished.chain, finished.id, "03:12.");
    await backend.say("", "Draft the launch post");
    const { unmount } = render(<Harness backend={backend} />);
    expect(await within(list()).findByRole("button", { name: /Draft the launch post/ })).toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /03:12/ })).not.toBeInTheDocument();

    fireEvent.click(within(list()).getByRole("button", { name: "Show done chats (1)" }));
    expect(within(list()).getByRole("button", { name: /03:12/ })).toBeInTheDocument();
    fireEvent.click(within(list()).getByRole("button", { name: "Hide done chats" }));
    expect(within(list()).queryByRole("button", { name: /03:12/ })).not.toBeInTheDocument();
    unmount();

    // Opened (from the feed, say), a finished chat stays in the list.
    render(<Harness backend={backend} start={finished.chain} />);
    expect(await within(list()).findByRole("button", { name: /03:12/ })).toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /Show done chats/ })).not.toBeInTheDocument();
  });

  it("answers your agent's question from its options in the chat", async () => {
    const backend = new DemoBackend(false, 0);
    const q = await backend.say("", "Clean up #calimero");
    backend.agentAsk(q.chain, q.id, "Two hellos there. Delete one?", { kind: "choose", prompt: "Delete one?", options: ["Delete it", "Keep both"], draft: "" });
    render(<Harness backend={backend} start={q.chain} />);
    const options = await screen.findByRole("group", { name: "Delete one?" });
    await act(async () => {
      fireEvent.click(within(options).getByRole("button", { name: "Delete it" }));
    });
    expect(await within(thread()).findByText("Delete it")).toBeInTheDocument();
    expect(within(thread()).queryByRole("group", { name: "Delete one?" })).not.toBeInTheDocument();
  });

  it("shows your agent's latest step while it works, not a log", async () => {
    let now = Date.now();
    const backend = new DemoBackend(false, 0, () => now);
    const q = await backend.say("", "Fix the chat list");
    backend.agentAck(q.id);
    backend.agentProgress(q.id, "Reading ChatView.tsx");
    now += 3_000;
    backend.agentProgress(q.id, "Running the tests");
    now += 12_000;
    render(<Harness backend={backend} start={q.chain} clock={() => now} />);
    const status = await screen.findByText(/Your agent is on it…/);
    expect(status).toHaveTextContent("Your agent is on it… Running the tests · 12 s ago");
    expect(within(thread()).queryByText(/Reading ChatView/)).not.toBeInTheDocument();
  });

  it("opens a chat from the list, and starts a new one", async () => {
    const backend = new DemoBackend(false, 0);
    const first = await backend.say("", "First question");
    await backend.say("", "Second question");
    render(<Harness backend={backend} />);
    const first_ = await within(list()).findByRole("button", { name: /First question/ });
    await act(async () => {
      fireEvent.click(first_);
    });
    expect(await screen.findByText("First question", { selector: ".bubble p" })).toBeInTheDocument();
    expect(within(thread()).queryByText("Second question")).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    });
    expect(screen.getByRole("heading", { name: "Talk to your agent" })).toBeInTheDocument();
    expect(first.chain).toBeTruthy();
  });

  it("says why a message was not sent, and keeps your words", async () => {
    class NoSay extends DemoBackend {
      override async say(): Promise<never> {
        throw Object.assign(new Error("FunctionCallError"), { data: 'method "say" not found' });
      }
    }
    render(<Harness backend={new NoSay(false, 0)} />);
    await say("testing this");
    expect(await screen.findByRole("alert")).toHaveTextContent(/made by an earlier Hyperfeed/);
    expect(screen.getByLabelText("Message your agent")).toHaveValue("testing this");
  });

  describe("in a browser whose scrollIntoView returns a promise", () => {
    // Chromium's newer scrollIntoView returns a Promise. An effect that hands
    // it back to React is taken for a clean-up and crashes the page on the
    // next update.
    const original = Element.prototype.scrollIntoView;
    afterEach(() => {
      Element.prototype.scrollIntoView = original;
    });

    it("keeps updating the open chat", async () => {
      Element.prototype.scrollIntoView = (() => Promise.resolve()) as unknown as typeof original;
      const backend = new DemoBackend(false, 0);
      render(<Harness backend={backend} />);
      await say("Still there?");
      const [asked] = await backend.chain((await backend.feed("agent", "")).items[0]!.chain);
      await act(async () => void backend.agentSay(asked!.chain, asked!.id, "Yes."));
      expect(await within(thread()).findByText("Yes.")).toBeInTheDocument();
    });
  });
});
