import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLastVisit,
  forgetProject,
  forgetTeam,
  lastVisitKey,
  pickRemembered,
  readLastVisit,
  rememberProject,
  rememberTeam,
  resumeRequested,
  shouldResume,
} from "./lastVisit";

const NODE = "http://localhost:2430";

describe("last visit", () => {
  beforeEach(() => localStorage.clear());

  it("is empty on a cold start", () => {
    expect(readLastVisit(NODE)).toEqual({});
  });

  it("remembers the team, and the project per team", () => {
    rememberProject(NODE, "team-a", "proj-1");
    rememberProject(NODE, "team-b", "proj-2");
    rememberTeam(NODE, "team-a");
    const v = readLastVisit(NODE);
    expect(v.team).toBe("team-a");
    expect(v.projects).toEqual({ "team-a": "proj-1", "team-b": "proj-2" });
  });

  it("is kept per node: another node's ids mean nothing here", () => {
    rememberTeam(NODE, "team-a");
    expect(readLastVisit("http://other-node:2430").team).toBeUndefined();
    // A trailing slash is the same node.
    expect(lastVisitKey(`${NODE}/`)).toBe(lastVisitKey(NODE));
  });

  it("forgets a team and its project, keeping the others", () => {
    rememberProject(NODE, "team-b", "proj-2");
    rememberProject(NODE, "team-a", "proj-1");
    forgetTeam(NODE, "team-a");
    const v = readLastVisit(NODE);
    expect(v.team).toBeUndefined();
    expect(v.projects).toEqual({ "team-b": "proj-2" });
  });

  it("forgets a deleted project, keeping its team", () => {
    rememberProject(NODE, "team-a", "proj-1");
    forgetProject(NODE, "team-a", "proj-1");
    const v = readLastVisit(NODE);
    expect(v.projects?.["team-a"]).toBeUndefined();
    expect(v.team).toBe("team-a");
  });

  it("is cleared on logout, for that node only", () => {
    rememberTeam(NODE, "team-a");
    rememberTeam("http://other-node:2430", "team-z");
    clearLastVisit(NODE);
    expect(readLastVisit(NODE)).toEqual({});
    expect(readLastVisit("http://other-node:2430").team).toBe("team-z");
  });

  it("survives a corrupt entry", () => {
    localStorage.setItem(lastVisitKey(NODE), "{not json");
    expect(readLastVisit(NODE)).toEqual({});
    rememberTeam(NODE, "team-a");
    expect(readLastVisit(NODE).team).toBe("team-a");
  });
});

describe("pickRemembered", () => {
  it("resumes what the node still lists", () => {
    expect(pickRemembered(["a", "b"], "b")).toBe("b");
  });
  it("never guesses: gone or unknown shows the list", () => {
    expect(pickRemembered(["a", "b"], "gone")).toBeNull();
    expect(pickRemembered(["a", "b"], undefined)).toBeNull();
    expect(pickRemembered([], "a")).toBeNull();
  });
});

describe("shouldResume", () => {
  it("resumes only from the default redirect", () => {
    expect(shouldResume({ state: { resume: true } })).toBe(true);
    expect(shouldResume({ state: null })).toBe(false);
  });
  it("never bounces a deliberate visit to the list", () => {
    expect(shouldResume({ state: null })).toBe(false);
    expect(shouldResume({ state: { other: 1 } })).toBe(false);
  });
  it("resumes into a project only when asked to", () => {
    expect(resumeRequested({ state: { resume: true } })).toBe(true);
    expect(resumeRequested({ state: null })).toBe(false);
  });
});
