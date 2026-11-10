// A name used to be asked for on every board. It is per team now: asked when
// you create or join the team, and a board opening in a team that has your
// name never asks. Only a team made before that asks, once, and never before
// the team's names have loaded.

import { beforeEach, describe, expect, it } from "vitest";
import { decideBoardName } from "./boardName";

beforeEach(() => localStorage.clear());

describe("decideBoardName", () => {
  it("never asks before the team's names have loaded", () => {
    expect(decideBoardName({ teamReady: false, teamName: "", boardName: "" })).toEqual({ kind: "wait" });
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: null })).toEqual({ kind: "wait" });
  });

  it("joins a new board under the team name instead of asking", () => {
    expect(decideBoardName({ teamReady: true, teamName: "Sandi", boardName: "" })).toEqual({
      kind: "use", name: "Sandi", join: true, adopt: false,
    });
  });

  it("never asks in a team that has your name, whatever the board knows", () => {
    for (const boardName of ["", "Sandi", "Old"]) {
      expect(decideBoardName({ teamReady: true, teamName: "Sandi", boardName }).kind).toBe("use");
    }
  });

  it("brings a board up to date after a rename", () => {
    expect(decideBoardName({ teamReady: true, teamName: "Sandi F", boardName: "Sandi" })).toEqual({
      kind: "use", name: "Sandi F", join: true, adopt: false,
    });
    expect(decideBoardName({ teamReady: true, teamName: "Sandi", boardName: "Sandi" })).toEqual({
      kind: "use", name: "Sandi", join: false, adopt: false,
    });
  });

  it("gives the team a name picked on a board before names were per team, unasked", () => {
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "Ana" })).toEqual({
      kind: "use", name: "Ana", join: false, adopt: true,
    });
  });

  it("gives the team a name this browser kept, and joins the board under it", () => {
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "", legacyName: "Ana" })).toEqual({
      kind: "use", name: "Ana", join: true, adopt: true,
    });
  });

  it("asks, once for the team, only when nobody knows a name for you", () => {
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "" })).toEqual({ kind: "ask", suggestion: "" });
    localStorage.setItem("calimero-names:last", "Sandi");
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "" })).toEqual({
      kind: "ask", suggestion: "Sandi",
    });
  });
});
