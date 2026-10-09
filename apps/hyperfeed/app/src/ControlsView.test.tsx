import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { ControlsView } from "./ControlsView";
import { DemoBackend } from "./demo";
import { demoPreview } from "./preview";
import { useFeed } from "./useFeed";

function Harness({ backend }: { backend: DemoBackend }) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return <ControlsView feed={feed} contextId={null} preview={demoPreview()} />;
}

describe("Controls: what your feed reads from each app", () => {
  it("previews a lens on recent events, then approves it", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const section = await screen.findByRole("region", { name: "What your feed reads from each app" });
    const vote = (await within(section).findByText("Polls you can vote in, as they open. Ballots are sealed: you vote in the Vote app.")).closest("li")!;
    expect(within(vote).getByText("Waiting for you")).toBeInTheDocument();
    expect(vote).toHaveTextContent("VotingOpened → Poll");
    await act(async () => {
      fireEvent.click(within(vote).getByRole("button", { name: "Preview on recent events" }));
    });
    const preview = await within(vote).findByRole("list", { name: "What the Vote lens would do" });
    expect(preview).toHaveTextContent("VotingOpened → Poll: Vote open: Offsite location");
    expect(preview).toHaveTextContent("BallotCast · not recorded (BallotCast is ignored)");
    await act(async () => {
      fireEvent.click(within(vote).getByRole("button", { name: "Approve" }));
    });
    expect(await within(vote).findByText("In use")).toBeInTheDocument();
  });

  it("shows Chat's lens skipping chatter and your own messages", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const section = await screen.findByRole("region", { name: "What your feed reads from each app" });
    const chat = (await within(section).findByText(/DMs, mentions of you/)).closest("li")!;
    await act(async () => {
      fireEvent.click(within(chat).getByRole("button", { name: "Preview on recent events" }));
    });
    const rows = within(await within(chat).findByRole("list", { name: "What the Chat lens would do" })).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      'MessageSent → Message: Mentioned you · Maya Ortiz · "@you can you check the deck?"',
      "MessageSent · not recorded (not for you)",
      "ReactionUpdated · not recorded (ReactionUpdated is ignored)",
      "MessageSent · not recorded (not for you)",
    ]);
  });
});
