import { beforeEach, describe, expect, it } from "vitest";
import {
  forgetBoard,
  lastVisitKey,
  pickBoard,
  pickTeam,
  readLastVisit,
  rememberBoard,
  rememberTeam,
} from "./lastVisit";

const NODE = "http://localhost:2430";

describe("last visit", () => {
  beforeEach(() => localStorage.clear());

  it("is empty on a cold start", () => {
    expect(readLastVisit(NODE)).toEqual({});
  });

  it("remembers the team, and the board per team", () => {
    rememberBoard(NODE, "team-a", "board-1");
    rememberBoard(NODE, "team-b", "board-2");
    rememberTeam(NODE, "team-a");
    const v = readLastVisit(NODE);
    expect(v.team).toBe("team-a");
    expect(v.boards).toEqual({ "team-a": "board-1", "team-b": "board-2" });
    expect(v.boardTeams).toEqual({ "board-1": "team-a", "board-2": "team-b" });
  });

  it("is kept per node: another node's ids mean nothing here", () => {
    rememberTeam(NODE, "team-a");
    expect(readLastVisit("http://other-node:2430").team).toBeUndefined();
    // A trailing slash is the same node.
    expect(lastVisitKey(`${NODE}/`)).toBe(lastVisitKey(NODE));
  });

  it("forgets a deleted board", () => {
    rememberBoard(NODE, "team-a", "board-1");
    forgetBoard(NODE, "team-a", "board-1");
    const v = readLastVisit(NODE);
    expect(v.boards?.["team-a"]).toBeUndefined();
    expect(v.boardTeams?.["board-1"]).toBeUndefined();
    expect(v.team).toBe("team-a");
  });

  it("survives a corrupt entry", () => {
    localStorage.setItem(lastVisitKey(NODE), "{not json");
    expect(readLastVisit(NODE)).toEqual({});
    rememberTeam(NODE, "team-a");
    expect(readLastVisit(NODE).team).toBe("team-a");
  });
});

describe("pickTeam", () => {
  it("resumes the remembered team when the node still lists it", () => {
    expect(pickTeam(["a", "b"], "b")).toBe("b");
  });
  it("falls back to the first listed team when it does not", () => {
    expect(pickTeam(["a", "b"], "gone")).toBe("a");
    expect(pickTeam(["a", "b"], undefined)).toBe("a");
  });
  it("is none on a node with no teams", () => {
    expect(pickTeam([], "a")).toBeNull();
  });
});

describe("pickBoard", () => {
  it("resumes a board the team still lists", () => {
    expect(pickBoard(["x", "y"], "y")).toBe("y");
  });
  it("never guesses: a deleted or unknown board opens the team home", () => {
    expect(pickBoard(["x", "y"], "gone")).toBeNull();
    expect(pickBoard(["x", "y"], undefined)).toBeNull();
  });
});
