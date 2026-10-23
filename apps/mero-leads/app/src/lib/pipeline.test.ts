import { describe, expect, it } from "vitest";
import type { LeadView } from "../generated/LeadsClient";
import { ago, byStatus, isStatus, matches, nextStatus, STATUSES, toCsv } from "./pipeline";

const NS = 1_000_000;

function lead(over: Partial<LeadView> = {}): LeadView {
  return {
    id: "a".repeat(32),
    created_at: Date.UTC(2026, 9, 1) * NS,
    name: "Ada Lovelace",
    email: "ada@example.com",
    company: "Analytical Engines",
    message: "We'd like a sealed node.",
    source: "/contact/",
    status: "new",
    notes: "",
    owner: "",
    submitted_by: "f0".repeat(32),
    updated_at: 0,
    updated_by: "",
    original_name: "Ada Lovelace",
    original_email: "ada@example.com",
    original_company: "Analytical Engines",
    ...over,
  };
}

describe("pipeline", () => {
  it("knows the contract's statuses, in order", () => {
    expect(STATUSES).toEqual(["new", "contacted", "qualified", "won", "lost", "spam"]);
    expect(isStatus("won")).toBe(true);
    expect(isStatus("maybe")).toBe(false);
  });

  it("moves on through the open steps and stops at won", () => {
    expect(nextStatus("new")).toBe("contacted");
    expect(nextStatus("qualified")).toBe("won");
    expect(nextStatus("won")).toBeNull();
    expect(nextStatus("lost")).toBeNull();
    expect(nextStatus("spam")).toBeNull();
  });

  it("groups by status, and an unknown status reads as new", () => {
    const groups = byStatus([lead({ id: "1", status: "won" }), lead({ id: "2", status: "odd" }), lead({ id: "3" })]);
    expect(groups.won.map((l) => l.id)).toEqual(["1"]);
    expect(groups.new.map((l) => l.id)).toEqual(["2", "3"]);
    expect(groups.spam).toEqual([]);
  });

  it("searches contact details, message and notes, ignoring case", () => {
    expect(matches(lead(), "")).toBe(true);
    expect(matches(lead(), "ANALYTICAL")).toBe(true);
    expect(matches(lead({ notes: "called Tuesday" }), "tuesday")).toBe(true);
    expect(matches(lead(), "babbage")).toBe(false);
  });

  it("says how long ago a node timestamp was", () => {
    const now = Date.UTC(2026, 9, 1, 12);
    expect(ago(now * NS, now)).toBe("just now");
    expect(ago((now - 5 * 60_000) * NS, now)).toBe("5 min ago");
    expect(ago((now - 3 * 3_600_000) * NS, now)).toBe("3 h ago");
    expect(ago((now - 2 * 86_400_000) * NS, now)).toBe("2 d ago");
  });

  it("exports CSV that a spreadsheet reads back, quoting what needs it", () => {
    const csv = toCsv([lead({ message: 'Hi, "team"\nsecond line' })]);
    const [head, row] = csv.split("\n");
    expect(head).toBe("created,status,name,email,company,source,message,notes");
    expect(row).toContain("2026-10-01T00:00:00.000Z,new,Ada Lovelace,ada@example.com");
    expect(csv).toContain('"Hi, ""team""\nsecond line"');
  });
});
