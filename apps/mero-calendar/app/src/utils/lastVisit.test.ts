import { beforeEach, describe, expect, it } from "vitest";
import {
  clearLastVisit,
  forgetCalendar,
  forgetTeam,
  lastVisitKey,
  pickRemembered,
  readLastVisit,
  rememberCalendar,
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

  it("remembers the team, and the calendar per team", () => {
    rememberCalendar(NODE, "team-a", "cal-1");
    rememberCalendar(NODE, "team-b", "cal-2");
    rememberTeam(NODE, "team-a");
    const v = readLastVisit(NODE);
    expect(v.team).toBe("team-a");
    expect(v.calendars).toEqual({ "team-a": "cal-1", "team-b": "cal-2" });
  });

  it("is kept per node: another node's ids mean nothing here", () => {
    rememberTeam(NODE, "team-a");
    expect(readLastVisit("http://other-node:2430").team).toBeUndefined();
    // A trailing slash is the same node.
    expect(lastVisitKey(`${NODE}/`)).toBe(lastVisitKey(NODE));
  });

  it("forgets a team and its calendar, keeping the others", () => {
    rememberCalendar(NODE, "team-b", "cal-2");
    rememberCalendar(NODE, "team-a", "cal-1");
    forgetTeam(NODE, "team-a");
    const v = readLastVisit(NODE);
    expect(v.team).toBeUndefined();
    expect(v.calendars).toEqual({ "team-b": "cal-2" });
  });

  it("forgets a deleted calendar, keeping its team", () => {
    rememberCalendar(NODE, "team-a", "cal-1");
    forgetCalendar(NODE, "team-a", "cal-1");
    const v = readLastVisit(NODE);
    expect(v.calendars?.["team-a"]).toBeUndefined();
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
  it("resumes into a calendar only when asked to", () => {
    expect(resumeRequested({ state: { resume: true } })).toBe(true);
    expect(resumeRequested({ state: null })).toBe(false);
  });
});
