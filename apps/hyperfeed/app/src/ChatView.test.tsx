import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ChatView, UNANSWERED_MS } from "./ChatView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { clearGithubCache } from "./github";
import { REFRESH_RUNNING_MS } from "./RefCards";
import merged435 from "./fixtures/github/pull-435-merged.json";
import headsSessionGrant from "./fixtures/github/pulls-head-session-grant.json";
import {
  fakeGitHub,
  greenRuns,
  jobs,
  openPr,
  openStacked,
  pendingRuns,
  prRoutes,
  PR_URL,
  rateLimited,
  redRuns,
  run,
  RUN_URL,
} from "./test/github";

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
  // No test reaches the real GitHub: links to it find nothing unless a test says otherwise.
  beforeEach(() => {
    vi.stubGlobal("fetch", fakeGitHub([]));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearGithubCache();
  });

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

  it("says mero-bot isn't connected when nothing picks your message up and no agent reports in", async () => {
    let now = Date.now();
    const backend = new DemoBackend(false, 0, () => now);
    const fresh = await backend.say("", "Anyone there?");
    const { unmount } = render(<Harness backend={backend} start={fresh.chain} clock={() => now} />);
    expect(await screen.findByText("Sent · waiting for your agent")).toBeInTheDocument();
    unmount();
    now += UNANSWERED_MS + 1_000;
    render(<Harness backend={backend} start={fresh.chain} clock={() => now} />);
    expect(await screen.findByText(/mero-bot isn't connected to this feed/)).toBeInTheDocument();
  });

  it("says your agent is connected but behind when one reports in", async () => {
    let now = Date.now();
    // A demo agent that reports in but never answers: its delay is longer than the test.
    const backend = new DemoBackend(false, 10 * 60_000, () => now);
    const fresh = await backend.say("", "Anyone there?");
    now += UNANSWERED_MS + 1_000;
    render(<Harness backend={backend} start={fresh.chain} clock={() => now} />);
    expect(await screen.findByText(/Your agent is connected but hasn't picked this up yet/)).toBeInTheDocument();
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
    // An agent from before work reports: its latest step, in the collapsed block.
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Running the tests · 12 s ago");
    expect(within(thread()).getByText("Working…")).toBeInTheDocument();
    expect(within(thread()).queryByText(/Reading ChatView/)).not.toBeInTheDocument();
  });

  it("lists the turn's steps in a Working… block, streams the answer, and keeps the steps after", async () => {
    let now = Date.now();
    const backend = new DemoBackend(false, 0, () => now);
    const q = await backend.say("", "Fix the chat list");
    backend.agentAck(q.id);
    const t0 = now;
    backend.agentWork(q.id, [
      { id: "t1", title: "Reading ChatView.tsx", status: "done", at: t0 },
      { id: "t2", title: "Running the tests", status: "running", at: t0 + 3_000 },
    ], "The list now hides");
    now += 15_000;
    render(<Harness backend={backend} start={q.chain} clock={() => now} />);
    await screen.findByRole("log");

    // Collapsed: the latest step only.
    const toggle = await within(thread()).findByRole("button", { name: /Working…/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(thread()).getByRole("status")).toHaveTextContent("Running the tests · running · 12 s ago");
    expect(within(thread()).queryByText("Reading ChatView.tsx")).not.toBeInTheDocument();
    // The answer as it is written.
    expect(within(thread()).getByText("The list now hides")).toBeInTheDocument();

    // Open: every step, with its status and time.
    fireEvent.click(toggle);
    const steps = within(thread()).getByRole("list", { name: "Steps" });
    const rows = within(steps).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Reading ChatView.tsx");
    expect(rows[0]).toHaveTextContent("done · 15 s ago");
    expect(rows[1]).toHaveTextContent("Running the tests");

    // The draft streams in as the agent writes more.
    await act(async () => void backend.agentWork(q.id, [
      { id: "t1", title: "Reading ChatView.tsx", status: "done", at: t0 },
      { id: "t2", title: "Running the tests", status: "done", at: t0 + 3_000 },
    ], "The list now hides finished chats."));
    expect(await within(thread()).findByText("The list now hides finished chats.")).toBeInTheDocument();

    // Answered: the draft goes, the steps stay, folded away.
    await act(async () => void backend.agentSay(q.chain, q.id, "Done: finished chats are hidden."));
    expect(await within(thread()).findByText("Done: finished chats are hidden.")).toBeInTheDocument();
    expect(within(thread()).queryByText("The list now hides finished chats.")).not.toBeInTheDocument();
    expect(within(thread()).getByRole("button", { name: /Worked · 2 steps/ })).toBeInTheDocument();
    expect(within(thread()).queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("stops a turn: Stop records the request, and your agent's stop shows as stopped by you", async () => {
    const backend = new DemoBackend(false, 0);
    const q = await backend.say("", "Refactor everything");
    backend.agentAck(q.id);
    backend.agentWork(q.id, [{ id: "t1", title: "Reading the repo", status: "running", at: Date.now() }]);
    render(<Harness backend={backend} start={q.chain} />);
    await screen.findByRole("log");

    await act(async () => {
      fireEvent.click(await within(thread()).findByRole("button", { name: "Stop" }));
    });
    expect((await backend.chain(q.chain))[0]!.stop_at).toBeGreaterThan(0);
    const stopping = await within(thread()).findByRole("button", { name: "Stopping…" });
    expect(stopping).toBeDisabled();

    // mero-bot sees the request, interrupts the turn and closes the message.
    await act(async () => void backend.agentAck(q.id, "failed", "Stopped by you"));
    expect(await within(thread()).findByText("Stopped by you.")).toBeInTheDocument();
    expect(within(thread()).queryByRole("button", { name: /Stop/ })).not.toBeInTheDocument();
    expect(within(thread()).queryByText(/couldn't answer/)).not.toBeInTheDocument();
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

  it("deletes a chat once you confirm, and Undo brings it back", async () => {
    const backend = new DemoBackend(false, 0);
    const doomed = await backend.say("", "Old question");
    await backend.say("", "Keep this one");
    render(<Harness backend={backend} start={doomed.chain} />);
    expect(await screen.findByText("Old question", { selector: ".bubble p" })).toBeInTheDocument();

    // It asks first; Cancel leaves the chat alone.
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    const ask = screen.getByRole("group", { name: "Delete this chat?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Delete this chat?" })).not.toBeInTheDocument();
    expect(within(list()).getByRole("button", { name: /Old question/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("group", { name: "Delete this chat?" })).getByRole("button", { name: "Delete" }));
    });
    // Gone from your chats and your feed (archived, so not erased), and you are back at a new chat.
    expect(await screen.findByRole("heading", { name: "Talk to your agent" })).toBeInTheDocument();
    expect(within(list()).queryByRole("button", { name: /Old question/ })).not.toBeInTheDocument();
    expect(within(list()).getByRole("button", { name: /Keep this one/ })).toBeInTheDocument();
    expect((await backend.feed("all", "")).items.some((i) => i.chain === doomed.chain)).toBe(false);
    expect((await backend.feed("archived", "")).items.some((i) => i.chain === doomed.chain)).toBe(true);

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Chat deleted");
    await act(async () => {
      fireEvent.click(within(toast).getByRole("button", { name: "Undo" }));
    });
    expect(await within(list()).findByRole("button", { name: /Old question/ })).toBeInTheDocument();
  });

  it("offers Delete only on a chat you have open", async () => {
    const backend = new DemoBackend(false, 0);
    await backend.say("", "A question");
    render(<Harness backend={backend} />);
    await within(list()).findByRole("button", { name: /A question/ });
    expect(screen.queryByRole("button", { name: "Delete chat" })).not.toBeInTheDocument();
  });

  it("stays on the chat when the feed refuses to delete it", async () => {
    class NoArchive extends DemoBackend {
      override async archive(): Promise<never> {
        throw Object.assign(new Error("FunctionCallError"), { data: 'method "archive" not found' });
      }
    }
    const backend = new NoArchive(false, 0);
    const kept = await backend.say("", "Still here");
    render(<Harness backend={backend} start={kept.chain} />);
    expect(await screen.findByText("Still here", { selector: ".bubble p" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("group", { name: "Delete this chat?" })).getByRole("button", { name: "Delete" }));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Still here", { selector: ".bubble p" })).toBeInTheDocument();
    expect(screen.queryByText("Chat deleted")).not.toBeInTheDocument();
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

  describe("renders markdown in the bubbles", () => {
    async function answered(text: string) {
      const backend = new DemoBackend(false, 0);
      const q = await backend.say("", "status?");
      backend.agentSay(q.chain, q.id, text);
      render(<Harness backend={backend} start={q.chain} />);
      await screen.findByText("status?", { selector: ".bubble p" });
      return backend;
    }

    it("shows a list as a list, with bold, italic and inline code", async () => {
      await answered("Three PRs:\n\n- **#433** merged\n- *#434* waiting on `e2e`\n- #435 open");
      const list = await within(thread()).findByRole("list");
      const items = within(list).getAllByRole("listitem");
      expect(items.map((li) => li.textContent)).toEqual(["#433 merged", "#434 waiting on e2e", "#435 open"]);
      expect(within(items[0]!).getByText("#433").tagName).toBe("STRONG");
      expect(within(items[1]!).getByText("#434").tagName).toBe("EM");
      expect(within(items[1]!).getByText("e2e").tagName).toBe("CODE");
      expect(within(thread()).getByText("Three PRs:").tagName).toBe("P");
      expect(within(thread()).queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it("shows a fenced code block in monospace, and copies it", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      try {
        await answered("Run this:\n\n```sh\npnpm test\npnpm typecheck\n```\nThen tell me.");
        const code = await within(thread()).findByText(/pnpm test/, { selector: "pre code" });
        expect(code.textContent).toBe("pnpm test\npnpm typecheck");
        expect(within(thread()).getByText("Then tell me.")).toBeInTheDocument();
        await act(async () => {
          fireEvent.click(within(thread()).getByRole("button", { name: "Copy code" }));
        });
        expect(writeText).toHaveBeenCalledWith("pnpm test\npnpm typecheck");
        expect(within(thread()).getByRole("button", { name: "Copied" })).toBeInTheDocument();
      } finally {
        if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
        else delete (navigator as { clipboard?: unknown }).clipboard;
      }
    });

    it("opens links in a new tab, and leaves a javascript: link as text", async () => {
      await answered("See [the PR](https://github.com/calimero-network/apps/pull/434) and https://example.com/a_b. Not [this](javascript:alert(1)).");
      const pr = await within(thread()).findByRole("link", { name: "the PR" });
      expect(pr).toHaveAttribute("href", "https://github.com/calimero-network/apps/pull/434");
      expect(pr).toHaveAttribute("target", "_blank");
      expect(pr).toHaveAttribute("rel", "noopener noreferrer");
      // A bare URL is a link too, without the full stop after it.
      expect(within(thread()).getByRole("link", { name: "https://example.com/a_b" })).toHaveAttribute("href", "https://example.com/a_b");
      expect(within(thread()).queryByRole("link", { name: "this" })).not.toBeInTheDocument();
      expect(within(thread()).getAllByRole("link")).toHaveLength(2);
    });

    it("shows a script tag as the characters it is, and never runs it", async () => {
      const ran = vi.fn();
      (window as unknown as { pwned: () => void }).pwned = ran;
      await answered('<script>window.pwned()</script> and <img src=x onerror="window.pwned()"> and **<b>bold</b>**');
      const body = await within(thread()).findByText(/<script>window\.pwned\(\)<\/script>/);
      expect(body.closest(".bubble")!.querySelector("script, img, b")).toBeNull();
      expect(body.closest(".bubble")).toHaveTextContent('<img src=x onerror="window.pwned()">');
      expect(within(thread()).getByText("<b>bold</b>").tagName).toBe("STRONG");
      expect(ran).not.toHaveBeenCalled();
    });

    it("keeps your own message's text, markdown or not", async () => {
      const backend = new DemoBackend(false, 0);
      render(<Harness backend={backend} />);
      await say("Plain words with a 2 * 3 = 6 sum");
      expect(await within(thread()).findByText("Plain words with a 2 * 3 = 6 sum", { selector: ".bubble p" })).toBeInTheDocument();
    });
  });

  describe("cards for the PRs and CI runs a message links to", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      clearGithubCache();
    });

    async function agentLinks(text: string, routes: Parameters<typeof fakeGitHub>[0]) {
      const github = fakeGitHub(routes);
      vi.stubGlobal("fetch", github);
      const backend = new DemoBackend(false, 0);
      const q = await backend.say("", "status?");
      backend.agentSay(q.chain, q.id, text);
      render(<Harness backend={backend} start={q.chain} />);
      return { backend, chain: q.chain, github };
    }
    const card = () => screen.findByRole("group", { name: "Pull request calimero-network/apps#435" });

    it("shows a PR's title, repo, base, checks and state, and Merge asks your agent in the chat", async () => {
      const { backend, chain, github } = await agentLinks(`Opened ${PR_URL}, all green.`, prRoutes(openPr(), greenRuns()));
      const pr = await card();
      expect(within(pr).getByRole("link", { name: /a failure no retry can fix offers Archive/ })).toHaveAttribute("href", PR_URL);
      expect(pr).toHaveTextContent("calimero-network/apps#435");
      expect(pr).toHaveTextContent("into main");
      expect(within(pr).getByText("Open")).toBeInTheDocument();
      expect(within(pr).getByText("Checks passed (34)")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(within(pr).getByRole("button", { name: "Merge" }));
      });
      // A request to your agent, in this chat; nothing sent to GitHub but reads.
      const sent = await backend.chain(chain);
      expect(sent[sent.length - 1]).toMatchObject({ from: "you", body: `merge PR ${PR_URL}` });
      expect(github.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
    });

    it("offers Merge when green while checks run, and sends that request", async () => {
      const { backend, chain } = await agentLinks(`CI is running on ${PR_URL}`, prRoutes(openPr(), pendingRuns()));
      const pr = await card();
      expect(within(pr).getByText("Checks running: 2 of 34 left")).toBeInTheDocument();
      expect(within(pr).queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(pr).getByRole("button", { name: "Merge when green" }));
      });
      const sent = await backend.chain(chain);
      expect(sent[sent.length - 1]).toMatchObject({ body: `merge PR ${PR_URL} when green` });
    });

    it("names the failing job and won't merge on red", async () => {
      await agentLinks(`E2E broke on ${PR_URL}`, prRoutes(openPr(), redRuns()));
      const pr = await card();
      expect(within(pr).getAllByText("Checks failed: App metadata, E2E (hyperfeed / feed)").length).toBeGreaterThan(0);
      expect(within(pr).getByRole("button", { name: "Merge" })).toBeDisabled();
    });

    it("says to retarget a PR whose base PR merged, instead of merging into the dead branch", async () => {
      const url = "https://github.com/calimero-network/apps/pull/433";
      const { backend, chain } = await agentLinks(`Stacked: ${url}`, prRoutes(openStacked(), greenRuns(), undefined, headsSessionGrant));
      const pr = await screen.findByRole("group", { name: "Pull request calimero-network/apps#433" });
      expect(pr).toHaveTextContent("into fix/hyperfeed-session-grant");
      expect(within(pr).queryByRole("button", { name: /^Merge/ })).not.toBeInTheDocument();
      await act(async () => {
        fireEvent.click(within(pr).getByRole("button", { name: "Base merged: retarget to main" }));
      });
      const sent = await backend.chain(chain);
      expect(sent[sent.length - 1]).toMatchObject({ body: `retarget PR ${url} to main` });
    });

    it("shows a merged PR as merged, with nothing to do", async () => {
      await agentLinks(`Merged ${PR_URL}`, prRoutes(merged435, greenRuns()));
      const pr = await card();
      expect(within(pr).getByText("Merged")).toBeInTheDocument();
      expect(within(pr).queryByRole("button")).not.toBeInTheDocument();
    });

    it("falls back to the plain link when GitHub's rate limit is used up, or the repo is private", async () => {
      const secret = "https://github.com/calimero-network/secret/pull/1";
      const { github } = await agentLinks(`See ${PR_URL} and ${secret}`, [
        [/\/apps\//, rateLimited(Math.floor(Date.now() / 1000) + 600)],
      ]);
      // Both were asked for, and neither answered: the links in the message stand alone.
      await waitFor(() => expect(github.mock.calls.length).toBeGreaterThanOrEqual(2));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(within(thread()).getByRole("link", { name: PR_URL })).toHaveAttribute("target", "_blank");
      expect(within(thread()).getByRole("link", { name: secret })).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /Pull request/ })).not.toBeInTheDocument();
    });

    it("reads an open PR again while it is on screen", async () => {
      // Fake timers that still move on their own, so the waits below work.
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      const routes = prRoutes(openPr(), pendingRuns());
      await agentLinks(`Watching ${PR_URL}`, routes);
      expect(await within(await card()).findByText("Checks running: 2 of 34 left")).toBeInTheDocument();
      // CI finishes: the next read finds it green.
      routes[1]![1] = greenRuns();
      await act(async () => {
        vi.advanceTimersByTime(REFRESH_RUNNING_MS);
      });
      expect(await within(await card()).findByText("Checks passed (34)")).toBeInTheDocument();
      expect(within(await card()).getByRole("button", { name: "Merge" })).toBeEnabled();
    });

    it("shows a CI run's result and the jobs that failed", async () => {
      await agentLinks(`CI failed: ${RUN_URL}`, [
        [/\/jobs/, jobs()],
        [/\/actions\/runs\/38114772344$/, run()],
      ]);
      const ci = await screen.findByRole("group", { name: "Actions run calimero-network/apps run 38114772344" });
      expect(ci).toHaveTextContent("CI: feat(hyperfeed): live Working… block, streamed answer, and Stop in chat");
      expect(ci).toHaveTextContent("on feat/hyperfeed-live-work");
      expect(within(ci).getByText("Failed: App metadata, E2E (hyperfeed / feed)")).toBeInTheDocument();
    });
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

  describe("with images", () => {
    // jsdom has no object URLs; the page only hands them to <img>.
    const { createObjectURL, revokeObjectURL } = URL;
    beforeEach(() => {
      let n = 0;
      URL.createObjectURL = () => `blob:test/${n++}`;
      URL.revokeObjectURL = () => undefined;
    });
    afterEach(() => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    });

    const png = (name: string, bytes = 1024) => new File([new Uint8Array(bytes)], name, { type: "image/png" });
    const attach = async (...files: File[]) => {
      await act(async () => {
        fireEvent.change(screen.getByLabelText("Attach images", { selector: "input" }), { target: { files } });
      });
    };

    it("sends a picked image with your message, and shows it in the chat", async () => {
      const backend = new DemoBackend(false, 0);
      render(<Harness backend={backend} />);
      await attach(png("error.png"));
      expect(screen.getByRole("img", { name: "error.png" })).toBeInTheDocument();

      await say("What is this error?");
      const [asked] = (await backend.feed("agent", "")).items;
      expect(asked!.attachments).toEqual([expect.objectContaining({ name: "error.png", mime: "image/png", size: 1024 })]);
      // Stored as a blob, read back for the bubble.
      expect(await within(thread()).findByRole("img", { name: "error.png" })).toBeInTheDocument();
      expect(within(thread()).getByRole("link", { name: /Open error\.png full size/ })).toHaveAttribute("target", "_blank");
      expect(screen.queryByRole("button", { name: /Remove error\.png/ })).not.toBeInTheDocument();
    });

    it("sends an image on its own", async () => {
      const backend = new DemoBackend(false, 0);
      render(<Harness backend={backend} />);
      await attach(png("diagram.png"));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Send" }));
      });
      const [asked] = (await backend.feed("agent", "")).items;
      expect(asked).toMatchObject({ body: "", title: "Sent an image" });
    });

    it("turns away what is not an image, or too big, before uploading anything", async () => {
      const backend = new DemoBackend(false, 0);
      render(<Harness backend={backend} />);
      await attach(new File(["%PDF"], "spec.pdf", { type: "application/pdf" }));
      expect(screen.getByRole("alert")).toHaveTextContent("spec.pdf isn't a PNG, JPEG, WebP or GIF image.");
      await attach(png("huge.png", 10 * 1024 * 1024 + 1));
      expect(screen.getByRole("alert")).toHaveTextContent("huge.png is 10.0 MB; the limit is 10 MB.");
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    });

    it("can take an image back before sending", async () => {
      render(<Harness backend={new DemoBackend(false, 0)} />);
      await attach(png("a.png"), png("b.png"));
      fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
      expect(screen.queryByRole("img", { name: "a.png" })).not.toBeInTheDocument();
      expect(screen.getByRole("img", { name: "b.png" })).toBeInTheDocument();
    });
  });
});
