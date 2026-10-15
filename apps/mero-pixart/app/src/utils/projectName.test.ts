// A name used to be asked for on every project. It is per team now: a project
// asks only when nobody knows a name for you, and never before the team's
// names have loaded.

import { describe, expect, it } from "vitest";
import { decideProjectName } from "./projectName";

const base = { onProject: false, teamReady: true, teamName: "", legacyName: "" } as const;

describe("decideProjectName", () => {
  it("waits for the roster and for the team's names before deciding", () => {
    expect(decideProjectName({ ...base, onProject: null })).toEqual({ kind: "wait" });
    expect(decideProjectName({ ...base, teamReady: false })).toEqual({ kind: "wait" });
  });

  it("joins a new project under the team name instead of asking", () => {
    expect(decideProjectName({ ...base, teamName: "Sandi" })).toEqual({ kind: "join", name: "Sandi" });
  });

  it("uses a name this browser picked before names were per team", () => {
    expect(decideProjectName({ ...base, legacyName: " Ana " })).toEqual({ kind: "join", name: "Ana" });
  });

  it("prefers the team name over the legacy one", () => {
    expect(decideProjectName({ ...base, teamName: "Sandi", legacyName: "Ana" })).toEqual({ kind: "join", name: "Sandi" });
  });

  it("asks only when nobody knows a name for you", () => {
    expect(decideProjectName(base)).toEqual({ kind: "ask" });
  });

  it("does nothing on a project you are already on", () => {
    expect(decideProjectName({ ...base, onProject: true })).toEqual({ kind: "none" });
  });
});
