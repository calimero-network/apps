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
  ])("%s fits %s's ABI and covers every method", (name, app) => {
    const abi = abiOf(app);
    expect(validateActions(fixture(name), abi)).toEqual([]);
    expect(uncovered(fixture(name), abi)).toEqual([]);
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
