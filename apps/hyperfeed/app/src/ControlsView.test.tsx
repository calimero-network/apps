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

describe("Controls: standing rules", () => {
  const section = () => screen.findByRole("region", { name: "Standing rules" });

  it("starts with none, then adds and removes your rules", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} />);
    const rules = await section();
    expect(within(rules).getByText(/No rules yet/)).toBeInTheDocument();
    fireEvent.change(within(rules).getByLabelText("New rule"), { target: { value: "Never push to main" } });
    await act(async () => {
      fireEvent.click(within(rules).getByRole("button", { name: "Add" }));
    });
    const list = await within(rules).findByRole("list", { name: "Your standing rules" });
    expect(within(list).getByText("Never push to main")).toBeInTheDocument();
    expect(within(rules).getByLabelText("New rule")).toHaveValue("");
    expect((await backend.settings()).rules.map((r) => r.text)).toEqual(["Never push to main"]);
    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: 'Remove "Never push to main"' }));
    });
    expect(await within(rules).findByText(/No rules yet/)).toBeInTheDocument();
    expect((await backend.settings()).rules).toEqual([]);
  });

  it("approves a rule your agent suggested with one tap, as your own", async () => {
    const backend = new DemoBackend(true, 0);
    backend.proposeRule("Open a PR instead of pushing to main", "You told me not to push to main.");
    render(<Harness backend={backend} />);
    const rules = await section();
    const suggestion = within(rules).getByRole("listitem", { name: "Suggested rule: Open a PR instead of pushing to main" });
    expect(suggestion).toHaveTextContent("You told me not to push to main.");
    await act(async () => {
      fireEvent.click(within(suggestion).getByRole("button", { name: "Approve" }));
    });
    const list = await within(rules).findByRole("list", { name: "Your standing rules" });
    expect(within(list).getByText("Open a PR instead of pushing to main")).toBeInTheDocument();
    expect(within(rules).queryByRole("list", { name: "Rules your agent suggests" })).not.toBeInTheDocument();
    const settings = await backend.settings();
    expect(settings.rules.map((r) => r.text)).toEqual(["Open a PR instead of pushing to main"]);
    expect(settings.rule_proposals).toEqual([]);
  });

  it("dismisses a suggested rule without adding it", async () => {
    const backend = new DemoBackend(true, 0);
    backend.proposeRule("Use emoji in every answer");
    render(<Harness backend={backend} />);
    const rules = await section();
    await act(async () => {
      fireEvent.click(within(rules).getByRole("button", { name: "Dismiss" }));
    });
    expect(within(rules).queryByRole("list", { name: "Rules your agent suggests" })).not.toBeInTheDocument();
    expect((await backend.settings()).rules).toEqual([]);
  });
});
