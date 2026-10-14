import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { NeedsYou, opensIn } from "./NeedsYou";
import type { Attention } from "./useAttention";

const attention: Attention = { supported: true, on: false, blocked: false, toggle: async () => undefined };

function Harness({
  backend,
  onOpen = () => undefined,
  onSettings = () => undefined,
}: {
  backend: DemoBackend;
  onOpen?: (chain: string) => void;
  onSettings?: (section: string) => void;
}) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <NeedsYou feed={feed} attention={attention} onOpen={(i) => onOpen(i.chain)} onSettings={onSettings} onClose={() => undefined} />;
}

async function approvalInChat(backend: DemoBackend) {
  const q = await backend.say("", "Run the tests");
  backend.agentAck(q.id);
  await backend.recordAction({
    app: "mero-bot",
    source_context: "",
    source_label: "This computer",
    method: "Bash",
    category: "",
    writes: true,
    undoable: false,
    title: "Run npm test",
    body: "$ npm test",
    why: "",
    outcome: "proposed",
    intent_hash: "",
    executor: "",
    note: "",
    chain: q.chain,
    ask: { kind: "choose", prompt: "Run it?", options: ["Allow once", "Allow for this session"], draft: "" },
    grant: "",
    subject: "",
    send_call: "",
  });
  return q.chain;
}

describe("Needs you, behind the bell", () => {
  it("lists every chain waiting on you as one line each, and a click opens it", async () => {
    const backend = new DemoBackend(false, 0);
    const chain = await approvalInChat(backend);
    const q = await backend.say("", "Clean up #calimero");
    backend.agentAsk(q.chain, q.id, "Two hellos there. Delete one?", { kind: "choose", prompt: "Delete one?", options: ["Delete it", "Keep both"], draft: "" });
    const opened = vi.fn();
    render(<Harness backend={backend} onOpen={opened} />);

    const panel = await screen.findByRole("dialog", { name: "Needs you" });
    expect(await within(panel).findAllByRole("listitem")).toHaveLength(2);
    // A summary only: the answers are where the thing is.
    expect(within(panel).queryByRole("button", { name: "Allow once" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Delete it" })).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: /Run npm test/ }));
    expect(opened).toHaveBeenCalledWith(chain);
    fireEvent.click(within(panel).getByRole("button", { name: /Your agent asks you/ }));
    expect(opened).toHaveBeenCalledWith(q.chain);

    // Settled elsewhere, it leaves the list.
    const action = (await backend.chain(chain)).find((i) => i.kind === "action")!;
    await act(async () => void (await backend.resolveAction(action.id, "approve", "Allow once")));
    await waitFor(() => expect(within(panel).getAllByRole("listitem")).toHaveLength(1));
  });

  it("lists the lenses and rules waiting in Settings, each opening its section", async () => {
    const backend = new DemoBackend(false, 0);
    // The pretend agent's lenses: Chat approved, Vote proposed.
    (backend as unknown as { seedLenses(): void }).seedLenses();
    backend.proposeRule("Never post in #general without asking");
    const sections = vi.fn();
    render(<Harness backend={backend} onSettings={sections} />);

    const settings = await screen.findByRole("list", { name: "In Settings" });
    expect(within(settings).getAllByRole("listitem")).toHaveLength(2);
    expect(within(settings).queryByText(/Chat: a lens/)).toBeNull();
    fireEvent.click(await within(settings).findByRole("button", { name: /Vote: a lens to approve/ }));
    expect(sections).toHaveBeenLastCalledWith("lenses");
    fireEvent.click(within(settings).getByRole("button", { name: /Never post in #general without asking/ }));
    expect(sections).toHaveBeenLastCalledWith("rules");
  });

  it("says so when nothing needs you", async () => {
    render(<Harness backend={new DemoBackend(false, 0)} />);
    expect(await screen.findByText("Nothing needs you.")).toBeInTheDocument();
  });
});

describe("where a row opens", () => {
  it("opens your agent's question and a command it asked about in their chat, anything else in the feed", async () => {
    const backend = new DemoBackend(true, 0);
    const waiting = (await backend.feed("needs_you", "")).items;
    for (const i of waiting) expect(opensIn(i)).toBe(i.kind === "message" ? "chat" : "feed");
    const chain = await approvalInChat(backend);
    expect(opensIn((await backend.chain(chain)).find((i) => i.kind === "action")!)).toBe("chat");
  });
});
