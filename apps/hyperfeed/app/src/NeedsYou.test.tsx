import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { NeedsYou } from "./NeedsYou";
import type { Attention } from "./useAttention";

const attention: Attention = { supported: true, on: false, blocked: false, toggle: async () => undefined };

function Harness({ backend, onOpen = () => undefined }: { backend: DemoBackend; onOpen?: (chain: string) => void }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <NeedsYou feed={feed} attention={attention} onOpen={(i) => onOpen(i.chain)} onSettings={() => undefined} onClose={() => undefined} />;
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
  });
  return q.chain;
}

describe("Needs you, behind the bell", () => {
  it("lists every chain waiting on you, and approves one in place", async () => {
    const backend = new DemoBackend(false, 0);
    const chain = await approvalInChat(backend);
    const q = await backend.say("", "Clean up #calimero");
    backend.agentAsk(q.chain, q.id, "Two hellos there. Delete one?", { kind: "choose", prompt: "Delete one?", options: ["Delete it", "Keep both"], draft: "" });
    const opened = vi.fn();
    render(<Harness backend={backend} onOpen={opened} />);

    const panel = await screen.findByRole("dialog", { name: "Needs you" });
    const rows = await within(panel).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(panel).getByText("Run npm test")).toBeInTheDocument();
    expect(within(panel).getByText("Your agent asks you")).toBeInTheDocument();

    const approval = rows.find((r) => within(r).queryByText("Run npm test"))!;
    fireEvent.click(within(approval).getByRole("button", { name: "Open" }));
    expect(opened).toHaveBeenCalledWith(chain);

    await act(async () => {
      fireEvent.click(within(approval).getByRole("button", { name: "Allow once" }));
    });
    expect((await backend.chain(chain)).find((i) => i.kind === "action")!.status).toBe("approved");
    expect(await within(panel).findAllByRole("listitem")).toHaveLength(1);
  });

  it("lists the lenses and rules waiting in Settings, and approves a lens in place", async () => {
    const backend = new DemoBackend(false, 0);
    // The pretend agent's lenses: Chat approved, Vote proposed.
    (backend as unknown as { seedLenses(): void }).seedLenses();
    backend.proposeRule("Never post in #general without asking");
    render(<Harness backend={backend} />);

    const settings = await screen.findByRole("list", { name: "In Settings" });
    const lens = await within(settings).findByRole("listitem", { name: "Lens for Vote" });
    expect(within(settings).queryByRole("listitem", { name: "Lens for Chat" })).toBeNull();
    expect(within(settings).getByText("Never post in #general without asking")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(lens).getByRole("button", { name: "Approve" }));
    });
    expect((await backend.lenses()).find((l) => l.app === "vote")!.status).toBe("approved");
    await waitFor(() => expect(within(settings).queryByRole("listitem", { name: "Lens for Vote" })).toBeNull());
  });

  it("says so when nothing needs you", async () => {
    render(<Harness backend={new DemoBackend(false, 0)} />);
    expect(await screen.findByText("Nothing needs you.")).toBeInTheDocument();
  });
});
