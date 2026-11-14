import { describe, expect, it } from "vitest";
import type { AppAbi, AppAbiMethod, PackageCapabilities } from "@calimero-network/mero-js";

import {
  abiFileName,
  actionCount,
  actionGroups,
  codeLine,
  dataStatements,
  exceptions,
  humanize,
  rawFacts,
  shortSigner,
  summarize,
  type ActionGroup,
} from "./workspaceFacts";

const BUNDLE = "7f3a".padEnd(60, "0") + "c91e";
const NODE_HASH = "aa11".padEnd(60, "0") + "bb22";

const method = (extra: Partial<AppAbiMethod> = {}): AppAbiMethod => ({
  kind: "call",
  params: [],
  returns: null,
  confirm: false,
  public: false,
  allowSystem: false,
  ...extra,
});

const abi = (methods: Record<string, AppAbiMethod>, events: unknown = {}): AppAbi => ({
  abiVersion: "1",
  world: "calimero:app@0.5.1",
  state: "",
  methods,
  errors: [],
  events: events as unknown[],
});

const caps = (over: Partial<PackageCapabilities> = {}): PackageCapabilities => ({
  package: "network.calimero.crm",
  version: "1.4.0",
  service: null,
  bundle: BUNDLE,
  mpk: "mpk-hash",
  manifestHash: "manifest-hash",
  signer: "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK",
  name: "Mero CRM",
  author: null,
  outbound: [],
  abi: abi({}),
  ...over,
});

const crm = caps({
  outbound: ["https://api.stripe.com/v1/"],
  abi: abi(
    {
      init: method({ kind: "init" }),
      deleteWorkspace: method({ confirm: true, params: [["workspaceId", "string"]] }),
      removeMember: method({ confirm: true }),
      exportAll: method({ kind: "view", confirm: true }),
      pipelineSummary: method({ kind: "view", public: true, rate: "10/s", returns: "list<Stage>", doc: "Deal counts per stage." }),
      createDeal: method(),
      listDeals: method({ kind: "view" }),
      sendReminders: method({ kind: "timer", every: "1h", allowSystem: true }),
      internalStep: method({ allowAction: true }),
      receiveResult: method({ computeResult: true, allowSystem: true }),
    },
    { DealMoved: { id: "string" }, NoteAdded: {} },
  ),
});

const group = (groups: ActionGroup[], id: string) => groups.find((g) => g.id === id);
const line = (c: PackageCapabilities, id: string) => summarize(c).find((l) => l.id === id);

describe("humanize", () => {
  it.each([
    ["deleteWorkspace", "Delete workspace"],
    ["delete_workspace", "Delete workspace"],
    ["pipelineSummary", "Pipeline summary"],
    ["exportAll", "Export all"],
    ["x", "X"],
    ["", ""],
  ])("%s -> %s", (name, shown) => expect(humanize(name)).toBe(shown));
});

describe("summarize", () => {
  it("says what matters, each line only when the card backs it", () => {
    const lines = summarize(crm);
    expect(lines.map((l) => l.id)).toEqual(["passkey", "public", "outside", "timers", "apps"]);
    expect(line(crm, "passkey")?.title).toBe("Asks for your passkey before 3 sensitive actions");
    expect(line(crm, "passkey")?.detail).toBe("Delete workspace, Remove member, Export all");
    expect(line(crm, "public")?.title).toBe("Shows 1 thing to anyone, without signing in");
    expect(line(crm, "outside")?.detail).toBe("api.stripe.com");
    expect(line(crm, "timers")?.title).toBe("Runs 1 task on its own");
    expect(line(crm, "timers")?.detail).toBe("Every 1 hour: Send reminders");
  });

  it("omits every line the card does not back", () => {
    const bare = caps({ abi: abi({ createDeal: method(), listDeals: method({ kind: "view" }) }) });
    expect(summarize(bare).map((l) => l.id)).toEqual(["apps"]);
  });

  it("claims no other app can use the data only when no method allows an app", () => {
    expect(line(crm, "apps")?.title).toBe("No other app can use your data");
    const shared = caps({ abi: abi({ onPayment: method({ allowApps: ["billing"] }), other: method({ allowApps: [] }) }) });
    expect(line(shared, "apps")?.title).toBe("Lets other apps call 1 action");
    expect(line(shared, "apps")?.detail).toBe("billing");
    expect(line(shared, "apps")?.tone).toBe("warn");
  });

  it("counts an app allowed on a hidden method too, and reads * as any app", () => {
    const hidden = caps({ abi: abi({ step: method({ allowAction: true, allowApps: ["*"] }) }) });
    expect(line(hidden, "apps")?.title).toBe("Lets other apps call 1 action");
    expect(line(hidden, "apps")?.detail).toBe("Any app");
  });

  it("makes no claim about the app's actions when it publishes no action list", () => {
    const none = caps({ abi: null, outbound: ["api.example.com"] });
    expect(summarize(none).map((l) => l.id)).toEqual(["outside"]);
  });

  it("shortens a long list of names", () => {
    const many = caps({ abi: abi(Object.fromEntries(["a", "b", "c", "d", "e"].map((n) => [n, method({ confirm: true })]))) });
    expect(line(many, "passkey")?.detail).toBe("A, B, C, and 2 more");
  });
});

describe("actionGroups", () => {
  const groups = actionGroups(crm);

  it("hides init, computeResult and allowAction-only methods from every group", () => {
    const titles = groups.flatMap((g) => g.items.map((i) => i.name));
    expect(titles).not.toContain("init");
    expect(titles).not.toContain("receiveResult");
    expect(titles).not.toContain("internalStep");
    expect(actionCount(crm.abi)).toBe(7);
  });

  it("groups in plain words, an action in every group it belongs to", () => {
    expect(groups.map((g) => g.label)).toEqual([
      "Needs your passkey",
      "Visible to anyone",
      "Changes your data",
      "Reads your data",
      "Runs on its own",
      "Outside services",
      "Updates it broadcasts",
    ]);
    expect(group(groups, "passkey")?.items.map((i) => i.title)).toEqual(["Delete workspace", "Remove member", "Export all"]);
    expect(group(groups, "changes")?.items.map((i) => i.name)).toEqual(["deleteWorkspace", "removeMember", "createDeal"]);
    expect(group(groups, "reads")?.items.map((i) => i.name)).toEqual(["exportAll", "pipelineSummary", "listDeals"]);
    expect(group(groups, "public")?.items.map((i) => i.name)).toEqual(["pipelineSummary"]);
    expect(group(groups, "timers")?.items.map((i) => i.name)).toEqual(["sendReminders"]);
  });

  it("lists outside services as enforced by the node and events by name", () => {
    expect(group(groups, "outside")?.items.map((i) => i.title)).toEqual(["https://api.stripe.com/v1/"]);
    expect(group(groups, "outside")?.blurb).toContain("enforced by the node");
    expect(group(groups, "events")?.items.map((i) => i.title)).toEqual(["Deal moved", "Note added"]);
  });

  it("leaves out a group with nothing in it", () => {
    const small = actionGroups(caps({ abi: abi({ createDeal: method() }) }));
    expect(small.map((g) => g.id)).toEqual(["changes"]);
  });

  it("puts a kind that fits no group under other methods", () => {
    const odd = actionGroups(caps({ abi: abi({ crunch: method({ kind: "compute" }) }) }));
    expect(odd.map((g) => g.id)).toEqual(["other"]);
  });

  it("states the technical facts of an action", () => {
    const del = group(groups, "passkey")?.items[0];
    const facts = Object.fromEntries((del?.facts ?? []).map((f) => [f.label, f.value]));
    expect(facts).toEqual({
      "Technical name": "deleteWorkspace",
      Type: "Change (call)",
      "Who can trigger": "You, signed in to this app",
      Confirmation: "Passkey prompt every time",
      Takes: "workspaceId: string",
      Returns: "Nothing",
      Limit: "None",
    });
    expect(del?.tags).toEqual(["passkey", "changes data"]);
  });

  it("says who can trigger it from public, system, apps and allowAction", () => {
    const who = (m: AppAbiMethod) => {
      const g = actionGroups(caps({ abi: abi({ m }) }));
      return g[0]?.items[0]?.facts.find((f) => f.label === "Who can trigger")?.value;
    };
    expect(who(method({ public: true }))).toBe("Anyone, no sign-in");
    expect(who(method({ allowSystem: true }))).toBe("You, signed in to this app; the system");
    expect(who(method({ allowApps: ["billing", "*"] }))).toBe("You, signed in to this app; apps: billing, any app");
    expect(who(method({ allowAction: true, public: true }))).toBe("Anyone, no sign-in; the app's own actions");
  });

  it("shows the limit of a public view and the interval of a timer", () => {
    const pub = group(groups, "public")?.items[0]?.facts.find((f) => f.label === "Limit");
    expect(pub?.value).toBe("10/s");
    const timer = group(groups, "timers")?.items[0]?.facts.find((f) => f.label === "Runs");
    expect(timer?.value).toBe("Every 1 hour");
  });

  it("keeps the publisher's description apart from the facts", () => {
    const view = group(groups, "public")?.items[0];
    expect(view?.doc).toBe("Deal counts per stage.");
    expect(view?.facts.some((f) => f.value.includes("Deal counts"))).toBe(false);
    expect(group(groups, "changes")?.items[0]?.doc).toBeUndefined();
  });

  it("is empty with no action list", () => {
    expect(actionGroups(caps({ abi: null, outbound: [] }))).toEqual([]);
    expect(actionCount(null)).toBe(0);
  });
});

describe("a publisher-controlled abi", () => {
  const exposed = caps({
    abi: abi({
      init: method({ kind: "init", public: true, confirm: true }),
      receiveResult: method({ kind: "view", computeResult: true, allowApps: ["billing"] }),
      stepOne: method({ allowAction: true, public: true }),
      stepTwo: method({ allowAction: true, allowSystem: true }),
      quiet: method({ allowAction: true }),
    }),
  });
  const shown = () => actionGroups(exposed).flatMap((g) => g.items.map((i) => i.name));

  it("shows an init or computeResult method that is public or open to an app, in Level 1 and the groups", () => {
    expect(line(exposed, "public")?.title).toBe("Shows 2 things to anyone, without signing in");
    expect(line(exposed, "passkey")?.title).toBe("Asks for your passkey before 1 sensitive action");
    expect(line(exposed, "apps")?.title).toBe("Lets other apps call 1 action");
    expect(shown()).toEqual(expect.arrayContaining(["init", "receiveResult", "stepOne", "stepTwo"]));
    expect(actionCount(exposed.abi)).toBe(4);
  });

  it("names a public view among the exceptions even when it is a computeResult method", () => {
    const view = caps({ abi: abi({ receiveResult: method({ kind: "view", computeResult: true, public: true }) }) });
    expect(exceptions(view)).toEqual(["Anyone can see: Receive result"]);
  });

  it("hides only a method with no outward exposure", () => {
    expect(shown()).not.toContain("quiet");
  });
});

describe("exceptions", () => {
  it("names each public view and each outbound host", () => {
    expect(exceptions(crm)).toEqual(["Anyone can see: Pipeline summary", "Leaves the sealed hardware: api.stripe.com"]);
  });

  it("does not count a public call or a private view", () => {
    const c = caps({ abi: abi({ ping: method({ public: true }), listDeals: method({ kind: "view" }) }) });
    expect(exceptions(c)).toEqual([]);
  });

  it("lists several hosts one per line", () => {
    const c = caps({ outbound: ["a.example.com", "https://b.example.com/x"] });
    expect(exceptions(c)).toEqual(["Leaves the sealed hardware: a.example.com", "Leaves the sealed hardware: b.example.com"]);
  });
});

describe("rawFacts", () => {
  it("lists the signed hashes in full", () => {
    expect(rawFacts(crm)).toEqual([
      { label: "Manifest hash", value: "manifest-hash" },
      { label: "WASM (bundle) hash", value: BUNDLE },
      { label: "Signer", value: crm.signer },
      { label: ".mpk hash", value: "mpk-hash" },
    ]);
  });

  it("names the ABI file after the package release", () => {
    expect(abiFileName(crm)).toBe("network.calimero.crm-1.4.0-abi.json");
  });
});

describe("codeLine", () => {
  const listed = { bundle: BUNDLE, package: "network.calimero.crm", version: "1.4.0" };

  it("before creating, comes from the signed release and is never attested", () => {
    const shown = codeLine(listed, null);
    expect(shown.text).toBe("bundle 7f3a…c91e, from the signed release");
    expect(shown.text).not.toContain("attested");
  });

  it("says a test server lists the release when the node is not sealed", () => {
    expect(codeLine(listed, null, false).text).toBe("bundle 7f3a…c91e, from the release as this test server lists it");
    const unknown = codeLine(listed, { status: "unknown", reason: "mock" }, false);
    expect(unknown.text).toBe("bundle 7f3a…c91e, from the release as this test server lists it");
  });

  it("is attested by the node only on a match, with the hash the node bound", () => {
    const shown = codeLine(listed, { status: "match", appHash: BUNDLE, checkedAt: 1 });
    expect(shown.text).toBe("bundle 7f3a…c91e, attested by this node");
    expect(shown.tone).toBe("good");
    expect(shown.note).toBeUndefined();
  });

  it("says which release the node's code was checked against when the match carries it", () => {
    const shown = codeLine(listed, { status: "match", appHash: BUNDLE, checkedAt: 1, package: "network.calimero.crm", version: "1.4.0" });
    expect(shown.text).toBe("bundle 7f3a…c91e, attested by this node");
    expect(shown.note).toBe("Node runs the code listed for network.calimero.crm v1.4.0");
  });

  it("does not attest a card of another release than the one the node's instance runs", () => {
    const shown = codeLine(listed, { status: "match", appHash: BUNDLE, checkedAt: 1, package: "network.calimero.crm", version: "1.3.0" });
    expect(shown.tone).toBe("bad");
    expect(shown.text).toBe("The node reports different code: it runs network.calimero.crm v1.3.0 (bundle 7f3a…c91e)");
    const other = codeLine(listed, { status: "match", appHash: BUNDLE, checkedAt: 1, package: "network.calimero.other", version: "1.4.0" });
    expect(other.tone).toBe("bad");
  });

  it("does not attest a match whose hash is not the card's", () => {
    const shown = codeLine(listed, { status: "match", appHash: NODE_HASH, checkedAt: 1, package: "network.calimero.crm", version: "1.4.0" });
    expect(shown.tone).toBe("bad");
    expect(shown.text).not.toContain("attested");
  });

  it("flags a mismatch and says what the node runs", () => {
    const shown = codeLine(listed, { status: "mismatch", appHash: NODE_HASH, expected: BUNDLE });
    expect(shown.tone).toBe("bad");
    expect(shown.text).toBe("Does not match the signed release: the node runs bundle aa11…bb22");
  });

  it("falls back to the signed release when the node could not check", () => {
    const shown = codeLine(listed, { status: "unknown", reason: "test server: the node's quote is a mock" });
    expect(shown.text).toBe("bundle 7f3a…c91e, from the signed release");
    expect(shown.note).toBe("This node could not confirm it: test server: the node's quote is a mock");
  });

  it("says it is checking while the node's answer is pending", () => {
    const shown = codeLine(listed, "pending");
    expect(shown.text).toBe("bundle 7f3a…c91e, from the signed release");
    expect(shown.note).toBe("Checking that this node runs it");
  });
});

describe("dataStatements", () => {
  it("makes the three claims only for a sealed node", () => {
    expect(dataStatements("verified")).toEqual(["Only you control it.", "Only people you invite can open it.", "Calimero can't read it."]);
    for (const kind of ["unsealed", "checking", "refused"] as const) expect(dataStatements(kind)).toEqual([]);
  });
});

describe("shortSigner", () => {
  it("keeps the did prefix and the ends", () => {
    expect(shortSigner("did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK")).toBe("did:key:z6Mk…2doK");
    expect(shortSigner("did:key:z6Mk")).toBe("did:key:z6Mk");
  });
});
