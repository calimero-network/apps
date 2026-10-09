import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { FeedView } from "./FeedView";
import { DemoBackend } from "./demo";
import { useFeed } from "./useFeed";

function Harness({ backend }: { backend: DemoBackend }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <FeedView feed={feed} query="" />;
}

describe("FeedView", () => {
  it("shows the agent's proposal and approves it", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const title = await screen.findByRole("button", { name: /Vendor NDA/ });
    const card = title.closest("article")!;
    expect(within(card).getByText("Waiting for you")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    });
    expect(await within(card).findByText("Approved · agent working")).toBeInTheDocument();
  });

  it("filters to what needs you", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await screen.findByRole("button", { name: /Vendor NDA/ });
    await act(async () => {
      fireEvent.click(within(screen.getByRole("navigation", { name: "Feed filters" })).getByRole("button", { name: /Needs you/ }));
    });
    expect(screen.queryByRole("button", { name: /Posted your stand-up/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vendor NDA/ })).toBeInTheDocument();
  });
});
