import { describe, expect, it } from "vitest";
import {
  CHUNK_CHARS,
  actionsToAdd,
  chunkTranscript,
  dueWords,
  notesModelFor,
  notesPrompt,
  parseNotes,
  writeNotes,
  type ChatMessage,
} from "./notes";

const line = (seq: number, speaker: string, text: string) => ({ seq, speaker, text });

describe("notes", () => {
  it("reads the model's answer, even with bold, numbering and empty fields", () => {
    const notes = parseNotes(
      [
        "**SUMMARY:**",
        "The team reviewed the launch.",
        "Brave still needs testing.",
        "",
        "**ACTION ITEMS:**",
        "1. Write release notes for the store listing | Ana | Thursday",
        "- **Test Brave shields** | Marko | Today",
        "* Record the demo video | - | -",
        "- Celebrate | Others | not specified",
        "- Book the venue | Me | Before launch",
        "- Record the demo video for the page | You (I) | Friday",
        "- Merge the release branch | Ana (Guest) | -",
      ].join("\n"),
    );
    expect(notes.summary).toBe("The team reviewed the launch. Brave still needs testing.");
    expect(notes.actions).toEqual([
      { text: "Write release notes for the store listing", assignee: "Ana", due: "Thursday" },
      { text: "Test Brave shields", assignee: "Marko", due: "Today" },
      { text: "Record the demo video", assignee: "", due: "" },
      { text: "Celebrate", assignee: "", due: "" },
      { text: "Book the venue", assignee: "", due: "Before launch" },
      { text: "Record the demo video for the page", assignee: "", due: "Friday" },
      { text: "Merge the release branch", assignee: "Ana", due: "" },
    ]);
  });

  it("reads an answer with no tasks, or no format at all", () => {
    expect(parseNotes("SUMMARY:\nA short catch-up.\nACTION ITEMS:\n- none").actions).toEqual([]);
    expect(parseNotes("I could not find anything.")).toEqual({ summary: "", actions: [] });
  });

  it("puts the due date in the task's words, once, and drops repeats and fragments", () => {
    const add = actionsToAdd(
      [
        { text: "write the release notes", assignee: "Ana", due: "Thursday" },
        { text: "Write the release notes", assignee: "Ana", due: "Thursday" },
        { text: "Send the deck by Friday", assignee: "", due: "Friday" },
        { text: "Ship", assignee: "", due: "" },
        { text: "Book the venue", assignee: "", due: "Before launch" },
      ],
      ["Book the venue (before launch)"],
    );
    expect(add).toEqual([
      { text: "Write the release notes (by Thursday)", assignee: "Ana" },
      { text: "Send the deck by Friday", assignee: "" },
    ]);
    expect(dueWords("Today")).toBe("by today");
    expect(dueWords("by Friday")).toBe("by Friday");
    expect(dueWords("Before Launch")).toBe("before launch");
    expect(dueWords("")).toBe("");
  });

  it("cuts a long transcript into parts without splitting a line", () => {
    const lines = Array.from({ length: 300 }, (_, i) => line(i, i % 2 ? "others" : "you", `This is sentence number ${i} of the call.`));
    const chunks = chunkTranscript(lines);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
    expect(chunks.join("\n").split("\n")).toHaveLength(300);
    expect(chunks[0]!.startsWith("Me: This is sentence number 0")).toBe(true);
    expect(chunkTranscript([line(0, "you", "   ")])).toEqual([]);
  });

  it("asks with a worked example before the transcript", () => {
    const p = notesPrompt("Me: hi", { index: 1, of: 3 });
    expect(p.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(p[2]!.content).toMatch(/^SUMMARY:/);
    expect(p[3]!.content).toBe("Transcript (part 2 of 3):\nMe: hi");
  });

  it("writes notes part by part and combines the summaries", async () => {
    const asked: ChatMessage[][] = [];
    const lines = Array.from({ length: 300 }, (_, i) => line(i, "others", `Long line ${i} about the roadmap and the launch.`));
    const parts: number[] = [];
    const notes = await writeNotes(
      lines,
      {
        generate: async (messages) => {
          asked.push(messages);
          if (messages[0]!.content.startsWith("You combine")) return "Summary: The whole meeting, combined.";
          return `SUMMARY:\nPart ${asked.length}.\nACTION ITEMS:\n- Task from part ${asked.length} | Ana | -`;
        },
      },
      (done, of) => parts.push(done / of),
    );
    const n = chunkTranscript(lines).length;
    expect(asked).toHaveLength(n + 1);
    expect(notes.summary).toBe("The whole meeting, combined.");
    expect(notes.actions).toHaveLength(n);
    expect(parts.at(-1)).toBe(1);
  });

  it("picks the model the laptop can run, or none without WebGPU", () => {
    expect(notesModelFor("auto", { webgpu: true, deviceMemoryGb: 8 })).toBe("better");
    expect(notesModelFor("auto", { webgpu: true, deviceMemoryGb: 4 })).toBe("small");
    expect(notesModelFor("better", { webgpu: true, deviceMemoryGb: 2 })).toBe("small");
    expect(notesModelFor("small", { webgpu: true, deviceMemoryGb: 16 })).toBe("small");
    expect(notesModelFor("auto", { webgpu: false, deviceMemoryGb: 16 })).toBeNull();
    expect(notesModelFor("off", { webgpu: true, deviceMemoryGb: 16 })).toBeNull();
  });
});
