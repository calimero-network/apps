import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ActionDef, ActionSetView } from "../generated/HyperfeedClient";
import type { Abi } from "../lens/validate";
import { groupSets, modeOf, uncovered, validateActions } from "./actions";

const APPS = path.resolve(__dirname, "../../../..");
const abiOf = (app: string) => JSON.parse(readFileSync(path.join(APPS, app, "logic/res/abi.json"), "utf8")) as Abi;
const fixture = (name: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8")) as ActionDef[];

describe("the shipped actions", () => {
  it.each([
    ["chat", "mero-chat"],
    ["docs", "mero-docs"],
    ["calendar", "mero-calendar"],
    ["sheets", "mero-sheets"],
    ["issues", "mero-issue-tracker"],
    ["crm", "mero-crm"],
    ["sign", "mero-sign"],
    ["pass", "mero-pass"],
  ])("%s fits %s's ABI and covers every method", (name, app) => {
    const abi = abiOf(app);
    expect(validateActions(fixture(name), abi)).toEqual([]);
    expect(uncovered(fixture(name), abi)).toEqual([]);
  });
});

/**
 * mero-mcp's node tools (2.9.1), as your agent sees your node: what each one
 * does to it. mero-bot keeps the same two lists (NODE_READS and NODE_WRITES in
 * src/hyperfeed/tools.ts) and judges these calls under the app key "node".
 * `call` and `call_many` reach apps, so each app's own actions judge them.
 */
const NODE_TOOLS: Abi = {
  methods: [
    ...["node_status", "list_nodes", "list_applications", "list_namespaces", "list_contexts", "lookup_alias", "list_blobs",
      "list_group_members", "describe_app", "select_app", "search_registry", "list_registry_versions"].map((name) => ({ name, params: [], intent: "read_only" as const })),
    ...["create_context", "join_context", "delete_context", "create_alias", "install_application", "uninstall_application",
      "upload_blob", "delete_blob", "create_namespace", "delete_namespace", "invite_to_namespace", "join_namespace",
      "leave_namespace", "add_group_members", "create_group", "set_group_visibility", "set_group_metadata",
      "join_open_group"].map((name) => ({ name, params: [] })),
  ],
  events: [],
};

describe("node management", () => {
  const node = fixture("node");

  it("fits mero-mcp's node tools and covers every one", () => {
    expect(validateActions(node, NODE_TOOLS)).toEqual([]);
    expect(uncovered(node, NODE_TOOLS)).toEqual([]);
  });

  it("keeps the switches on what they always covered", () => {
    const guardOf = (method: string) => node.find((a) => a.methods.includes(method))?.category;
    for (const m of ["uninstall_application", "leave_namespace", "delete_namespace", "delete_context", "delete_blob"]) {
      expect(guardOf(m), m).toBe("delete");
    }
    // Opening a group lets a whole space in: that is inviting people too.
    for (const m of ["invite_to_namespace", "add_group_members", "set_group_visibility"]) expect(guardOf(m), m).toBe("invite");
  });
});

describe("validateActions", () => {
  const abi: Abi = {
    methods: [
      { name: "init", params: [] },
      { name: "get", params: [], intent: "read_only" },
      { name: "post", params: [] },
      { name: "drop", params: [] },
    ],
    events: [],
  };
  const def = (over: Partial<ActionDef>): ActionDef => ({
    id: "a", label: "A", description: "", category: "", writes: true, methods: ["post"], ...over,
  });

  it("reports what would mislead the rules", () => {
    expect(validateActions([def({ methods: ["nope", "init"] })], abi)).toEqual([
      "a: nope is not a method the app has",
      "a: init is not a method the app has",
    ]);
    expect(validateActions([def({ writes: false, methods: ["get", "post"] })], abi)).toEqual([
      "a: post changes state, so this action writes",
    ]);
    expect(validateActions([def({}), def({ id: "b", methods: ["post"] })], abi)).toEqual(["b: post is already in a"]);
    expect(validateActions([def({}), def({ methods: ["drop"] })], abi)).toEqual(["a: two actions have this id"]);
    expect(validateActions([def({ category: "lunch" })], abi)).toEqual(['a: "lunch" is not a guard']);
    expect(validateActions([], abi)).toEqual(["an app needs at least one action"]);
  });

  it("lets a writing action cover a reading method, and leaves gaps to ask", () => {
    expect(validateActions([def({ methods: ["get", "post"] })], abi)).toEqual([]);
    expect(uncovered([def({})], abi)).toEqual(["get", "drop"]);
  });
});

describe("groupSets and modeOf", () => {
  const set = (application_id: string, status: string, updated_at: number): ActionSetView => ({
    app: "chat", application_id, actions: [], summary: "", status, updated_at,
  });

  it("puts the newest approved set in force and lists what waits", () => {
    const groups = groupSets([set("v1", "approved", 1), set("v2", "approved", 3), set("v3", "proposed", 4), set("v0", "rejected", 5)]);
    expect(groups.get("chat")?.active?.application_id).toBe("v2");
    expect(groups.get("chat")?.proposed.map((s) => s.application_id)).toEqual(["v3"]);
  });

  it("reads your setting for one action", () => {
    const modes = [{ app: "chat", action: "edit", mode: "act" }];
    expect(modeOf(modes, "chat", "edit")).toBe("act");
    expect(modeOf(modes, "chat", "send")).toBe("");
    expect(modeOf(undefined, "chat", "edit")).toBe("");
  });
});
