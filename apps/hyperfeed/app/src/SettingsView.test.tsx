import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { SettingsView, settingsSection, type SettingsSection } from "./SettingsView";
import { DemoBackend } from "./demo";
import { demoPreview } from "./preview";
import { useFeed } from "./useFeed";
import { appLook, DEFAULT_APPS } from "./apps";
import { CODE_APP } from "./assignments";

function Harness({
  backend,
  section = "controls",
  installed = null,
  install = null,
}: {
  backend: DemoBackend;
  section?: SettingsSection;
  installed?: string[] | null;
  install?: ((pkg: string) => Promise<void>) | null;
}) {
  const [nudge, setNudge] = useState(0);
  useEffect(() => backend.subscribe(() => setNudge((n) => n + 1)), [backend]);
  const feed = useFeed(backend, nudge);
  return (
    <MemoryRouter>
      <SettingsView feed={feed} contextId={null} preview={demoPreview()} section={section} installed={installed} install={install} />
    </MemoryRouter>
  );
}

describe("Settings: one section at a time", () => {
  const nav = () => screen.findByRole("navigation", { name: "Settings" });

  it("lists its sections, marks the open one, and shows only that one", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const links = within(await nav()).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/\d+$/, ""))).toEqual(["Controls", "Rules", "Agents", "Lenses"]);
    expect(within(await nav()).getByRole("link", { current: "page" })).toHaveTextContent("Controls");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/settings/controls", "/settings/rules", "/settings/agents", "/settings/lenses"]);
    expect(await screen.findByRole("region", { name: "Always ask me before" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "General rules" })).toBeNull();
    expect(screen.queryByRole("region", { name: "What your feed reads from each app" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Connect your agent" })).toBeNull();
  });

  it("counts the lenses waiting for you beside Lenses", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} />);
    const lenses = within(await nav()).getByRole("link", { name: /Lenses/ });
    expect(await within(lenses).findByLabelText(/waiting for you/)).toBeInTheDocument();
  });

  it("names an unknown section Controls", () => {
    expect(settingsSection(undefined)).toBe("controls");
    expect(settingsSection("nope")).toBe("controls");
    expect(settingsSection("agents")).toBe("agents");
    expect(settingsSection("rules")).toBe("rules");
  });

  it("lists who reports in under Agents, live or when last seen", async () => {
    render(<Harness backend={new DemoBackend(true, 1)} section="agents" />);
    const agents = await screen.findByRole("region", { name: "Your agents" });
    expect(within(agents).getByText("demo agent").closest("li")).toHaveTextContent("Live");
    expect(screen.getByRole("region", { name: "Connect your agent" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "General rules" })).toBeNull();
  });

  it("says no agent has reported in yet", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} section="agents" />);
    const agents = await screen.findByRole("region", { name: "Your agents" });
    expect(within(agents).getByText(/No agent has reported in yet/)).toBeInTheDocument();
  });
});

describe("Settings → Controls: what your agent may do, app by app", () => {
  const table = async () => within(await screen.findByRole("region", { name: "What your agent may do, app by app" })).getByRole("table");
  const rowOf = async (name: string) => (await within(await table()).findByRole("rowheader", { name: new RegExp(`${name}$`) })).closest("tr")!;
  // A row's app name, without its badge's letters or icon.
  const names = async () =>
    within(await table())
      .getAllByRole("rowheader")
      .map((h) => h.textContent!.slice(h.querySelector(".badge")?.textContent?.length ?? 0));

  it("sets what the agent may do in the core apps installed on your node, and offers Install for the rest", async () => {
    const install = vi.fn(async () => undefined);
    // The seeded feed has rows and policies in more apps; of the core ones only Chat and Docs are installed.
    render(<Harness backend={new DemoBackend(true, 0)} installed={["chat", "drive-docs", "vote"]} install={install} />);
    expect(await names()).toEqual(["Chat", "Drive Docs", "Calendar", "Sheets", "Issue Tracker", "CRM", "Sign", "Pass"]);
    expect(within(await rowOf("Chat")).getByRole("group", { name: "Agent permission in Chat" })).toBeInTheDocument();
    const calendar = await rowOf("Calendar");
    expect(within(calendar).queryByRole("group", { name: /Agent permission/ })).toBeNull();
    await act(async () => {
      fireEvent.click(within(calendar).getByRole("button", { name: "Install Calendar" }));
    });
    expect(install).toHaveBeenCalledWith("com.calimero.mero-calendar");
  });

  it("says why an install failed, beside its button", async () => {
    const install = vi.fn(async () => {
      throw new Error("Nothing is published for com.calimero.mero-pass.");
    });
    render(<Harness backend={new DemoBackend(false, 0)} installed={[]} install={install} />);
    const pass = await rowOf("Pass");
    await act(async () => {
      fireEvent.click(within(pass).getByRole("button", { name: "Install Pass" }));
    });
    expect(within(pass).getByRole("alert")).toHaveTextContent("Nothing is published for com.calimero.mero-pass.");
  });

  it("keeps mero-bot, the tools on your computer, once an agent reports in", async () => {
    // A demo with a pretend agent: it reports in.
    render(<Harness backend={new DemoBackend(false, 1)} installed={["chat"]} />);
    await waitFor(async () => expect((await names()).slice(0, 2)).toEqual(["Chat", appLook(CODE_APP).name]));
  });

  it("lists the usual apps until the node says what is installed", async () => {
    render(<Harness backend={new DemoBackend(false, 0)} />);
    expect(await names()).toEqual(DEFAULT_APPS.map((a) => appLook(a).name));
  });
});

describe("Settings → Lenses: what your feed reads from each app", () => {
  it("previews a lens on recent events, then approves it", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} section="lenses" />);
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
    render(<Harness backend={new DemoBackend(true, 0)} section="lenses" />);
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

describe("Settings → Rules: standing rules", () => {
  const section = () => screen.findByRole("region", { name: "General rules" });

  it("starts with none, then adds and removes your rules", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} section="rules" />);
    const rules = await section();
    expect(within(rules).getByText(/No rules yet/)).toBeInTheDocument();
    fireEvent.change(within(rules).getByLabelText("New rule"), { target: { value: "Never push to main" } });
    await act(async () => {
      fireEvent.click(within(rules).getByRole("button", { name: "Add" }));
    });
    const list = await within(rules).findByRole("list", { name: "Your general rules" });
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
    render(<Harness backend={backend} section="rules" />);
    const rules = await section();
    const suggested = screen.getByRole("region", { name: "Suggested by your agent" });
    const suggestion = within(suggested).getByRole("listitem", { name: "Suggested rule: Open a PR instead of pushing to main" });
    expect(suggestion).toHaveTextContent("You told me not to push to main.");
    await act(async () => {
      fireEvent.click(within(suggestion).getByRole("button", { name: "Approve" }));
    });
    const list = await within(rules).findByRole("list", { name: "Your general rules" });
    expect(within(list).getByText("Open a PR instead of pushing to main")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Suggested by your agent" })).not.toBeInTheDocument();
    const settings = await backend.settings();
    expect(settings.rules.map((r) => r.text)).toEqual(["Open a PR instead of pushing to main"]);
    expect(settings.rule_proposals).toEqual([]);
  });

  it("dismisses a suggested rule without adding it", async () => {
    const backend = new DemoBackend(true, 0);
    backend.proposeRule("Use emoji in every answer");
    render(<Harness backend={backend} section="rules" />);
    await section();
    await act(async () => {
      fireEvent.click(within(screen.getByRole("region", { name: "Suggested by your agent" })).getByRole("button", { name: "Dismiss" }));
    });
    expect(screen.queryByRole("region", { name: "Suggested by your agent" })).not.toBeInTheDocument();
    expect((await backend.settings()).rules).toEqual([]);
  });
});

describe("Settings → Rules: rules for one agent", () => {
  const section = () => screen.findByRole("region", { name: "Rules for one agent" });

  it("says to connect an agent while none has reported in", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} section="rules" />);
    expect(within(await section()).getByText(/No agent has reported in yet/)).toBeInTheDocument();
  });

  it("adds a rule for the picked agent only, beside the general rules every agent keeps", async () => {
    const backend = new DemoBackend(true, 0);
    backend.agentReach("mero-bot@studio", []);
    backend.agentReach("mero-bot@phone", []);
    await backend.addRule("Never push to main");
    render(<Harness backend={backend} section="rules" />);
    const panel = await section();
    expect(within(panel).getByLabelText("Agent")).toHaveValue("mero-bot@phone");
    fireEvent.change(within(panel).getByLabelText("Agent"), { target: { value: "mero-bot@studio" } });
    expect(within(panel).getByText("mero-bot@studio also keeps your language and 1 general rule.")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("New rule"), { target: { value: "Run the tests first" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: "Add" }));
    });
    const list = await within(panel).findByRole("list", { name: "Rules for mero-bot@studio" });
    expect(within(list).getByText("Run the tests first")).toBeInTheDocument();
    let settings = await backend.settings();
    expect(settings.agent_rules.map((r) => [r.agent, r.text])).toEqual([["mero-bot@studio", "Run the tests first"]]);
    expect(settings.rules.map((r) => r.text)).toEqual(["Never push to main"]);

    fireEvent.change(within(panel).getByLabelText("Agent"), { target: { value: "mero-bot@phone" } });
    expect(within(panel).getByText("No rules for mero-bot@phone yet.")).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Agent"), { target: { value: "mero-bot@studio" } });
    await act(async () => {
      fireEvent.click(within(panel).getByRole("button", { name: 'Remove "Run the tests first"' }));
    });
    settings = await backend.settings();
    expect(settings.agent_rules).toEqual([]);
  });
});

describe("Settings → Rules: the language your agent answers in", () => {
  const language = () => screen.findByRole("region", { name: "Language" });

  it("answers in English by default, with no rule", async () => {
    const backend = new DemoBackend(true, 0);
    render(<Harness backend={backend} section="rules" />);
    const panel = await language();
    expect(within(panel).getByLabelText("Answers in")).toHaveValue("English");
    expect(within(panel).getByText("Default")).toBeInTheDocument();
    expect((await backend.settings()).rules).toEqual([]);
  });

  it("picks a language as one rule, and swaps it for the next one picked", async () => {
    const backend = new DemoBackend(true, 0);
    await backend.addRule("Never push to main");
    render(<Harness backend={backend} section="rules" />);
    const panel = await language();
    await act(async () => {
      fireEvent.change(within(panel).getByLabelText("Answers in"), { target: { value: "German" } });
    });
    expect(within(panel).getByLabelText("Answers in")).toHaveValue("German");
    expect(within(panel).queryByText("Default")).toBeNull();
    expect((await backend.settings()).rules.map((r) => r.text)).toEqual([
      "Never push to main",
      "Always respond in German unless the user writes in another language.",
    ]);
    await act(async () => {
      fireEvent.change(within(panel).getByLabelText("Answers in"), { target: { value: "English" } });
    });
    expect((await backend.settings()).rules.map((r) => r.text)).toEqual([
      "Never push to main",
      "Always respond in English unless the user writes in another language.",
    ]);
  });

  it("shows a language rule you already had as the language, not in the list", async () => {
    const backend = new DemoBackend(true, 0);
    await backend.addRule("Always respond in English unless the user writes in another language.");
    await backend.addRule("Never push to main");
    render(<Harness backend={backend} section="rules" />);
    expect(within(await language()).getByLabelText("Answers in")).toHaveValue("English");
    const list = await within(await screen.findByRole("region", { name: "General rules" })).findByRole("list", { name: "Your general rules" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["1Never push to mainRemove"]);
  });
});

describe("Settings → Alerts: phone alerts", () => {
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

  it("is not there on a feed that predates push: Alerts opens Controls", async () => {
    render(<Harness backend={new DemoBackend(true, 0)} section="alerts" />);
    await screen.findByRole("region", { name: "Always ask me before" });
    expect(screen.queryByRole("region", { name: "Phone alerts" })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Settings" })).queryByRole("link", { name: /Alerts/ })).toBeNull();
  });

  it("says to start your agent's runtime before there is a key", async () => {
    render(<Harness backend={new PushDemo(true, 0)} section="alerts" />);
    expect(await within(await section()).findByText(/Start mero-bot against this feed first/)).toBeInTheDocument();
  });

  it("lists the devices pushed to, and takes one off", async () => {
    const backend = new PushDemo(true, 0);
    backend.key = "BRuntimeKey";
    render(<Harness backend={backend} section="alerts" />);
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

describe("Settings → Agents: what your agents can reach", () => {
  const section = () => screen.findByRole("region", { name: "What your agents can reach" });
  const AGENT = "mero-bot@laptop";
  const reported = (b: DemoBackend) =>
    b.agentReach(AGENT, [
      { serves: "default", profile: "near", model: "z-ai/glm-5.3-flash", attested: true, folders: [], shell: false, web: false },
      { serves: "converse", profile: "claude", model: "", attested: false, folders: [{ path: "~/workspace/calimero", write: true }], shell: true, web: true },
    ]);

  it("shows what each agent reports, then narrows it to what you set", async () => {
    const backend = new DemoBackend(true, 0);
    reported(backend);
    render(<Harness backend={backend} section="agents" />);
    const agent = within(await section()).getByRole("group", { name: `What ${AGENT} can reach` });
    expect(within(agent).getByRole("list", { name: `What ${AGENT} reports` })).toHaveTextContent(
      "Default · near (z-ai/glm-5.3-flash), attested: Calimero apps only",
    );
    expect(within(agent).getByText(/Your messages/).closest("li")).toHaveTextContent("claude: Calimero apps, ~/workspace/calimero, shell, web");
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
    render(<Harness backend={new OlderFeed(true, 0)} section="agents" />);
    await screen.findByRole("region", { name: "Your agents" });
    expect(screen.queryByRole("region", { name: "What your agents can reach" })).toBeNull();
  });
});

describe("Settings → Agents: who works in each app", () => {
  const section = () => screen.findByRole("region", { name: "Who works in each app" });
  const TEE = "mero-bot@td-1";
  const LAPTOP = "mero-bot@laptop";
  const line = (attested: boolean) => ({ serves: "default", profile: attested ? "near" : "claude", model: "", attested, folders: [], shell: false, web: false });

  it("leaves every app on your private agent until you give one to another agent", async () => {
    const backend = new DemoBackend(true, 0);
    backend.agentReach(TEE, [line(true)]);
    backend.agentReach(LAPTOP, [line(false)]);
    render(<Harness backend={backend} section="agents" />);
    const panel = await section();
    const code = within(panel).getByRole("combobox", { name: "Agent for Code" }) as HTMLSelectElement;
    const chat = within(panel).getByRole("combobox", { name: "Agent for Chat" }) as HTMLSelectElement;
    expect(code.value).toBe("");
    expect(within(panel).getByLabelText("The default agent")).toHaveTextContent(`DefaultPrivate${TEE}`);
    // Code has no default, and never goes to the private agent: it has no computer of yours.
    expect(within(code).getByRole("option", { name: "Off" })).toBeInTheDocument();
    expect(within(code).queryByRole("option", { name: `${TEE} · private` })).toBeNull();
    expect(within(code).getByRole("option", { name: LAPTOP })).toBeInTheDocument();
    expect(within(panel).getByText(/Off: no agent runs shell, files or git/)).toBeInTheDocument();
    expect(within(chat).getByRole("option", { name: "Default" })).toBeInTheDocument();
    expect(within(chat).getByRole("option", { name: `${TEE} · private` })).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(code, { target: { value: LAPTOP } });
    });
    expect((await backend.settings()).assignments).toMatchObject([{ app: "mero-bot", agent: LAPTOP }]);
    expect(code.value).toBe(LAPTOP);
    expect(within(panel).getByText("Shell, files and git on a computer")).toBeInTheDocument();
    // Chat stays with the private agent.
    expect(chat.value).toBe("");

    // Back to the default.
    await act(async () => {
      fireEvent.change(code, { target: { value: "" } });
    });
    expect((await backend.settings()).assignments).toEqual([]);
  });

  it("says any agent takes an app while no private agent reports in", async () => {
    const backend = new DemoBackend(true, 0);
    backend.agentReach(LAPTOP, [line(false)]);
    render(<Harness backend={backend} section="agents" />);
    expect(within(await section()).getByLabelText("The default agent")).toHaveTextContent("Any agent, until a private one reports in");
  });

  it("is not there on a feed that predates assignments", async () => {
    class OlderFeed extends DemoBackend {
      override async settings() {
        const { assignments: _a, ...rest } = await super.settings();
        return rest as Awaited<ReturnType<DemoBackend["settings"]>>;
      }
    }
    render(<Harness backend={new OlderFeed(true, 0)} section="agents" />);
    await screen.findByRole("region", { name: "Your agents" });
    expect(screen.queryByRole("region", { name: "Who works in each app" })).toBeNull();
  });
});
