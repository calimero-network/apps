import { describe, expect, it } from "vitest";
import { assignables, assigneeColor, assigneeInitials, callSpeakers } from "./assignee";

describe("assignees", () => {
  const speakers = [{ name: "Eve", color: "var(--spk-0)" }, { name: "Speaker 2", color: "var(--spk-1)" }];
  it("gives each person the same colour everywhere, from their name", () => {
    const people = assignables(speakers, []);
    expect(people[0]!.color).toBe(assigneeColor("Eve"));
    expect(assigneeColor("eve ", people)).toBe(assigneeColor("Eve"));
    expect(assigneeColor("Gus")).toBe(assigneeColor("gus"));
    expect(assigneeColor("Gus")).toMatch(/^var\(--spk-[0-6]\)$/);
  });
  it("lists speakers first, then members not already there", () => {
    expect(assignables(speakers, ["Eve", "Sam", " "]).map((p) => [p.name, p.source])).toEqual([
      ["Eve", "speaker"],
      ["Speaker 2", "speaker"],
      ["Sam", "member"],
    ]);
  });
  it("shortens names to initials", () => {
    expect(assigneeInitials("Eve Lee")).toBe("EL");
    expect(assigneeInitials("Speaker 2")).toBe("S2");
    expect(assigneeInitials("john")).toBe("JO");
  });

  it("names who spoke in a call as the page shows them, leaving out the unnamed others", () => {
    const meeting = {
      speakers: [
        { speaker: "others", name: "Speaker 1" },
        { speaker: "you", name: "" },
        { speaker: "others", name: "" },
        { speaker: "others", name: "Speaker 2" },
      ],
      speakerNames: [{ label: "Speaker 1", name: "John" }],
    };
    expect(callSpeakers(meeting, "Eve")).toEqual(["John", "Eve", "Speaker 2"]);
    expect(callSpeakers({ speakerNames: [] }, "Eve")).toEqual([]);
  });
});
