import { describe, expect, it } from "vitest";
import type { DayView, UpdateView } from "../generated/StandupClient";
import { byPerson, digestMarkdown } from "./digest";

const A = "a".repeat(64);
const B = "b".repeat(64);
const u = (author: string, name: string, day: string, done: string, blockers = ""): UpdateView => ({
  day,
  author,
  author_name: name,
  done,
  next: "",
  blockers,
  created_at: 0,
  edited_at: 0,
  helpers: [],
});
const week: DayView[] = [
  { day: "2026-10-12", updates: [u(B, "Bob", "2026-10-12", "b1"), u(A, "", "2026-10-12", "a1")] },
  { day: "2026-10-13", updates: [u(A, "Ana", "2026-10-13", "a2\nmore", "stuck")] },
];

describe("weekly digest", () => {
  it("groups by person, takes their latest name, sorts by name", () => {
    const people = byPerson(week);
    expect(people.map((p) => p.name)).toEqual(["Ana", "Bob"]);
    expect(people[0]!.updates.map((x) => x.done)).toEqual(["a1", "a2\nmore"]);
  });

  it("renders Markdown with one line per field", () => {
    const md = digestMarkdown("Platform", "2026-10-12", week);
    expect(md).toContain("# Platform — week of");
    expect(md).toContain("## Ana");
    expect(md).toContain("- Done: a2; more");
    expect(md).toContain("- Blocked: stuck");
    expect(digestMarkdown("", "2026-10-12", [])).toContain("_No updates this week._");
  });
});
