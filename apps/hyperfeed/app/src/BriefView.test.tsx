import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { BriefView } from "./BriefView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { BRIEF_BUDGET } from "./brief";

function Harness({ backend, focus, onFocused }: { backend: DemoBackend; focus?: string; onFocused?: () => void }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <BriefView feed={feed} query="" focus={focus} onFocused={onFocused} />;
}

const cardsIn = (el: HTMLElement) => within(el).getAllByRole("listitem").filter((li) => li.classList.contains("brief-card"));

describe("BriefView", () => {
  beforeEach(() => localStorage.clear());

  it("leads with how things stand and a few ranked decisions, holding the rest back", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    expect(screen.getByRole("region", { name: "How things stand" })).toHaveTextContent(/decisions? for you.*since the start of today/);
    expect(cardsIn(decisions)).toHaveLength(BRIEF_BUDGET);
    fireEvent.click(within(decisions).getByRole("button", { name: /more, less pressing/ }));
    expect(cardsIn(decisions).length).toBeGreaterThan(BRIEF_BUDGET);
  });

  it("says why a decision reached you, and shows its evidence", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    fireEvent.click(within(decisions).getByRole("button", { name: /more, less pressing/ }));
    const nda = within(decisions).getByText(/Vendor NDA/).closest("li")!;
    fireEvent.click(within(nda).getByRole("button", { name: "Why me?" }));
    expect(nda).toHaveTextContent("Signing anything always needs you");
    fireEvent.click(within(nda).getByRole("button", { name: /Evidence/ }));
    expect(await within(nda).findByRole("list", { name: "In this task" })).toBeInTheDocument();
  });

  it("keeps what your agent did apart from what was filtered out, and tunes a source into a rule", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const done = await screen.findByRole("region", { name: "Done for you" });
    expect(within(done).getAllByRole("listitem").length).toBeGreaterThan(0);
    const filtered = screen.getByRole("region", { name: "Filtered out" });
    const less = within(filtered).getAllByRole("button", { name: "Less like this" })[0]!;
    fireEvent.click(less);
    expect(await within(filtered).findByText("You'll get fewer like this")).toBeInTheDocument();
    const rules = (await backend.settings()).rules.map((r) => r.text);
    expect(rules.some((t) => /Record fewer updates from/.test(t))).toBe(true);
  });

  it("offers to stop asking for what you approved every time this week, and sets the action to act", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    const jordan = within(decisions).getByText(/Reply to Jordan/).closest("li")!;
    const offer = within(jordan).getByRole("group", { name: "Stop asking for this" });
    expect(offer).toHaveTextContent("You approved 3 of 3 like this one this week.");
    fireEvent.click(within(offer).getByRole("button", { name: "Always allow" }));
    await within(jordan).findByText(/Reply to Jordan/);
    await expect.poll(async () => (await backend.settings()).action_modes.find((m) => m.app === "chat" && m.action === "send")?.mode).toBe("act");
    expect(within(jordan).queryByRole("group", { name: "Stop asking for this" })).toBeNull();
  });

  it("shows what your team did where the task is, beside its own steps", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    const nda = within(decisions).getByText(/Vendor NDA/).closest("li")!;
    fireEvent.click(within(nda).getByRole("button", { name: /Evidence/ }));
    const around = await within(nda).findByRole("list", { name: "Around it, from your team" });
    expect(around).toHaveTextContent("Ronit Cohen");
  });

  it("tells a chain as your agent wrote it, with the rows it is about", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    const card = within(decisions).getByText("Maya needs the board numbers and the Northwind NDA before 2").closest("li")!;
    expect(card).toHaveTextContent("Written by your agent from 6 things in 3 apps");
    expect(card).toHaveTextContent("Your agent recommends");
    expect(card).toHaveTextContent(/About: .*Vendor NDA/);
  });

  it("shows when a proposal goes ahead by itself, and stops it", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    const jordan = within(decisions).getByText(/Reply to Jordan/).closest("li")!;
    const going = within(jordan).getByRole("group", { name: "Goes ahead by itself" });
    expect(going).toHaveTextContent(/Goes ahead in 1 h 20 min unless you stop it/);
    fireEvent.click(within(going).getByRole("button", { name: "Stop it" }));
    await expect.poll(async () => (await backend.autoruns())[0]!.status).toBe("stopped");
    await expect.poll(() => within(jordan).queryByRole("group", { name: "Goes ahead by itself" })).toBeNull();
  });

  it("brings the card the bell points at into view, even one held back", async () => {
    const backend = new DemoBackend(true, 0);
    const vote = (await backend.feed("all", "")).items.find((i) => i.title.startsWith("Vote"))!;
    let done = 0;
    render(<Harness backend={backend} focus={vote.chain} onFocused={() => done++} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    await expect.poll(() => done).toBe(1);
    // The focus lands, then the held-back card renders with the rest.
    const card = (await within(decisions).findByText(/Offsite location/)).closest("li")!;
    expect(card).toHaveClass("focused");
  });
});
