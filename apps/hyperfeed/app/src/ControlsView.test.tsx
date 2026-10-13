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

describe("Controls: phone alerts", () => {
  const section = () => screen.findByRole("region", { name: "Phone alerts" });
  const device = (endpoint: string, name: string, quiet = false) => ({
    endpoint,
    p256dh: "BKey",
    auth: "auth",
    name,
    quiet,
    added_at: 1,
  });

  class PushDemo extends DemoBackend {
    key = "";
    devices = [device("https://push.example/a", "iPhone"), device("https://push.example/b", "Android", true)];
    pushKey = async () => ({ public_key: this.key, by: "mero-bot", updated_at: 1 });
    pushDevices = async () => this.devices;
    removePushDevice = async (endpoint: string) => {
      this.devices = this.devices.filter((d) => d.endpoint !== endpoint);
    };
  }

  it("is not there on a feed that predates push", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    await screen.findByRole("region", { name: "Standing rules" });
    expect(screen.queryByRole("region", { name: "Phone alerts" })).toBeNull();
  });

  it("says to start your agent's runtime before there is a key", async () => {
    render(<Harness backend={new PushDemo(true, 0)} />);
    expect(await within(await section()).findByText(/Start mero-bot against this feed first/)).toBeInTheDocument();
  });

  it("lists the devices pushed to, and takes one off", async () => {
    const backend = new PushDemo(true, 0);
    backend.key = "BRuntimeKey";
    render(<Harness backend={backend} />);
    const panel = await section();
    const list = await within(panel).findByRole("list", { name: "Devices your agent pushes to" });
    expect(within(list).getAllByRole("listitem").map((li) => li.firstChild?.textContent)).toEqual(["iPhone", "Android · quiet"]);
    // jsdom has no service workers: this browser can't subscribe itself.
    expect(within(panel).getByText(/This browser can't take pushes/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(list).getByRole("button", { name: "Stop pushing to iPhone" }));
    });
    expect(within(list).queryByText("iPhone")).toBeNull();
    expect(backend.devices.map((d) => d.name)).toEqual(["Android"]);
  });
});

describe("Controls: what your agents can reach", () => {
  const section = () => screen.findByRole("region", { name: "What your agents can reach" });
  const AGENT = "mero-bot@laptop";
  const reported = (b: DemoBackend) =>
    b.agentReach(AGENT, [
      { serves: "private", profile: "near", model: "z-ai/glm-5.3-flash", attested: true, folders: [], shell: false, web: false },
      { serves: "public", profile: "claude", model: "", attested: false, folders: [{ path: "~/workspace/calimero", write: true }], shell: true, web: true },
    ]);

  it("shows what each agent reports, then narrows it to what you set", async () => {
    const backend = new DemoBackend(true, 0);
    reported(backend);
    render(<Harness backend={backend} />);
    const agent = within(await section()).getByRole("group", { name: `What ${AGENT} can reach` });
    expect(within(agent).getByRole("list", { name: `What ${AGENT} reports` })).toHaveTextContent(
      "Private · near (z-ai/glm-5.3-flash), attested: Calimero apps only",
    );
    expect(within(agent).getByText(/Public/).closest("li")).toHaveTextContent("claude: Calimero apps, ~/workspace/calimero, shell, web");
    expect(within(agent).getByText(/Not set by you/)).toBeInTheDocument();

    // Starts from what it reported: the workspace, read and write, shell and web on.
    const folders = within(agent).getByRole("list", { name: `Folders ${AGENT} may use` });
    expect(folders).toHaveTextContent("~/workspace/calimero");
    expect(within(agent).getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(within(agent).getByLabelText("Add a folder"), { target: { value: "notes" } });
    fireEvent.click(within(agent).getByRole("button", { name: "Add" }));
    expect(within(agent).getByRole("alert")).toHaveTextContent("absolute path, or one under ~");

    fireEvent.change(within(agent).getByLabelText("Add a folder"), { target: { value: "~/Documents/specs/" } });
    fireEvent.click(within(agent).getByRole("button", { name: "Add" }));
    expect(folders).toHaveTextContent("~/Documents/specs");
    fireEvent.click(within(agent).getByLabelText(/Shell/));
    fireEvent.click(within(agent).getByLabelText(/Web/));
    await act(async () => {
      fireEvent.click(within(agent).getByRole("button", { name: "Save" }));
    });

    const [set] = (await backend.settings()).access!;
    expect(set).toMatchObject({
      agent: AGENT,
      folders: [
        { path: "~/workspace/calimero", write: true },
        { path: "~/Documents/specs", write: false },
      ],
      shell: false,
      web: false,
    });
    expect(await within(agent).findByRole("button", { name: "Save" })).toBeDisabled();
    expect(within(agent).queryByText(/Not set by you/)).toBeNull();
  });

  it("is not there on a feed that predates access", async () => {
    class OlderFeed extends DemoBackend {
      override async settings() {
        const { access: _a, reach: _r, ...rest } = await super.settings();
        return rest as Awaited<ReturnType<DemoBackend["settings"]>>;
      }
    }
    render(<Harness backend={new OlderFeed(true, 0)} />);
    await screen.findByRole("region", { name: "Standing rules" });
    expect(screen.queryByRole("region", { name: "What your agents can reach" })).toBeNull();
  });
});
