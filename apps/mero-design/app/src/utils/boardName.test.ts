// A name used to be asked for on every board. It is per team now: a board
// asks only when the team has no name for you at all, and never before the
// team's names have loaded.

import { describe, expect, it } from "vitest";
import { decideBoardName } from "./boardName";

describe("decideBoardName", () => {
  it("never asks before the team's names have loaded", () => {
    expect(decideBoardName({ teamReady: false, teamName: "", boardName: "" })).toEqual({ kind: "wait" });
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: null })).toEqual({ kind: "wait" });
  });

  it("joins a new board under the team name instead of asking", () => {
    expect(decideBoardName({ teamReady: true, teamName: "Sandi", boardName: "" })).toEqual({
      kind: "join",
      name: "Sandi",
    });
  });

  it("brings a board up to date after a rename", () => {
    expect(decideBoardName({ teamReady: true, teamName: "Sandi F", boardName: "Sandi" })).toEqual({
      kind: "join",
      name: "Sandi F",
    });
    expect(decideBoardName({ teamReady: true, teamName: "Sandi", boardName: "Sandi" })).toEqual({ kind: "none" });
  });

  it("adopts a name picked on a board before names were per team", () => {
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "Ana" })).toEqual({ kind: "adopt", name: "Ana" });
  });

  it("asks only when nobody knows a name for you", () => {
    expect(decideBoardName({ teamReady: true, teamName: "", boardName: "" })).toEqual({ kind: "ask" });
  });
});
