import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { BriefView } from "./BriefView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";
import { BRIEF_BUDGET } from "./brief";

function Harness({ backend }: { backend: DemoBackend }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <BriefView feed={feed} query="" />;
}

describe("BriefView", () => {
  it("leads with how things stand and a few ranked decisions, holding the rest back", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    expect(screen.getByRole("region", { name: "How things stand" })).toHaveTextContent(/decisions? for you/);
    const cards = within(decisions).getAllByRole("listitem").filter((li) => li.classList.contains("brief-card"));
    expect(cards).toHaveLength(BRIEF_BUDGET);
    // What your agent did without asking comes first, then the signature its guard holds for you.
    expect(cards[0]).toHaveTextContent("Acted without asking");
    expect(cards[1]).toHaveTextContent("Vendor NDA");
    const more = within(decisions).getByRole("button", { name: /more, less pressing/ });
    fireEvent.click(more);
    expect(within(decisions).getAllByRole("listitem").filter((li) => li.classList.contains("brief-card")).length).toBeGreaterThan(BRIEF_BUDGET);
  });

  it("says why a decision reached you, and shows its evidence", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const decisions = await screen.findByRole("region", { name: "Decisions for you" });
    const nda = within(decisions).getByText(/Vendor NDA/).closest("li")!;
    fireEvent.click(within(nda).getByRole("button", { name: "Why me?" }));
    expect(nda).toHaveTextContent("Signing anything always needs you.");
    fireEvent.click(within(nda).getByRole("button", { name: /Evidence/ }));
    expect(await within(nda).findByRole("list", { name: "Evidence" })).toBeInTheDocument();
  });

  it("folds away what was handled without you", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const handled = await screen.findByRole("region", { name: "Handled quietly" });
    expect(within(handled).queryByRole("list")).toBeNull();
    fireEvent.click(within(handled).getByRole("button", { expanded: false }));
    expect(within(handled).getByRole("list")).toBeInTheDocument();
  });
});
