// A name used to be asked for on every project. It is per team now: asked when
// you create or join the team, and a project opening in a team that has your
// name never asks. Only a team made before that asks, once, and never before
// the team's names have loaded.

import { beforeEach, describe, expect, it } from "vitest";
import { decideProjectName } from "./projectName";

const base = { onProject: false, rosterName: "", teamReady: true, teamName: "", legacyName: "" } as const;

beforeEach(() => localStorage.clear());

describe("decideProjectName", () => {
  it("waits for the roster and for the team's names before deciding", () => {
    expect(decideProjectName({ ...base, onProject: null })).toEqual({ kind: "wait" });
    expect(decideProjectName({ ...base, teamReady: false })).toEqual({ kind: "wait" });
  });

  it("joins a new project under the team name instead of asking", () => {
    expect(decideProjectName({ ...base, teamName: "Sandi" })).toEqual({
      kind: "use", name: "Sandi", join: true, adopt: false,
    });
  });

  it("never asks in a team that has your name, whatever the project knows", () => {
    for (const onProject of [false, true]) {
      for (const rosterName of ["", "Old"]) {
        const action = decideProjectName({ ...base, onProject, rosterName, teamName: "Sandi" });
        expect(action.kind).toBe("use");
      }
    }
    // Even before the team's read settles, once its name is known.
    expect(decideProjectName({ ...base, teamReady: false, teamName: "Sandi" }).kind).toBe("use");
  });

  it("gives the team a name the roster already had, without asking or joining again", () => {
    expect(decideProjectName({ ...base, onProject: true, rosterName: "Ana" })).toEqual({
      kind: "use", name: "Ana", join: false, adopt: true,
    });
  });

  it("gives the team a name this browser picked before names were per team", () => {
    expect(decideProjectName({ ...base, legacyName: " Ana " })).toEqual({
      kind: "use", name: "Ana", join: true, adopt: true,
    });
  });

  it("prefers the team name over the legacy one", () => {
    expect(decideProjectName({ ...base, teamName: "Sandi", legacyName: "Ana" })).toEqual({
      kind: "use", name: "Sandi", join: true, adopt: false,
    });
  });

  it("asks, once for the team, only when nobody knows a name for you", () => {
    expect(decideProjectName(base)).toEqual({ kind: "ask", suggestion: "" });
    localStorage.setItem("calimero-names:last", "Sandi");
    expect(decideProjectName(base)).toEqual({ kind: "ask", suggestion: "Sandi" });
  });
});
