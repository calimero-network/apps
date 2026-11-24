import { describe, expect, it } from "vitest";
import { MAX_ACTIONS, actionIn, findActions, sentences, tidy } from "./actionItems";

const call = [
  ["you", "Morning everyone, thanks for joining. Let's go through the launch plan for Minutes."],
  ["others", "Morning! I pulled the numbers from the beta, about forty teams tried it last week."],
  ["you", "Great. The big question from the beta was the model download on older laptops."],
  ["you", "Okay. Ana, can you write the release notes for the store listing by Thursday?"],
  ["others", "Yes, I'll have a draft by Thursday and share it in the channel."],
  ["you", "Marko, we still need the Brave check, the shields sometimes hide WebGPU."],
  ["others", "I'll test Brave on my machine today and send screenshots of the fallback."],
  ["you", "Perfect. Last thing, we need a short demo video for the landing page."],
  ["others", "I can record it on Friday once the store build is up."],
  ["you", "Great, that's everything. Can you hear me okay? Thanks all, talk on Monday."],
].map(([speaker, text], seq) => ({ seq, speaker: speaker!, text: text! }));

describe("action items", () => {
  it("finds the requests, commitments and team tasks in a real call", () => {
    const found = findActions(call);
    expect(found).toEqual([
      { text: "Write the release notes for the store listing by Thursday", assignee: "Ana", sourceSeq: 3 },
      { text: "Have a draft by Thursday and share it in the channel", assignee: "", sourceSeq: 4 },
      { text: "We still need the Brave check, the shields sometimes hide WebGPU", assignee: "Marko", sourceSeq: 5 },
      { text: "Test Brave on my machine today and send screenshots of the fallback", assignee: "", sourceSeq: 6 },
      { text: "We need a short demo video for the landing page", assignee: "", sourceSeq: 7 },
      { text: "Record it on Friday once the store build is up", assignee: "", sourceSeq: 8 },
    ]);
  });

  it("turns a commitment into a task", () => {
    expect(actionIn("I'll send the deck to the design team.", "you")).toEqual({ text: "Send the deck to the design team", assignee: "" });
  });

  it("reads names, explicit markers and team plans", () => {
    expect(actionIn("Ana, please update the pricing page.", "you")).toEqual({ text: "Update the pricing page", assignee: "Ana" });
    expect(actionIn("Action item: migrate the billing tables", "you")?.text).toBe("Migrate the billing tables");
    expect(actionIn("Don't forget to renew the domain.", "others")?.text).toBe("Renew the domain");
    expect(actionIn("We should book the venue for March.", "others")?.text).toBe("Book the venue for March");
    expect(actionIn("Let's ship the beta to ten more teams.", "you")?.text).toBe("Ship the beta to ten more teams");
    expect(actionIn("Could you please send me the contract?", "others")).toEqual({ text: "Send me the contract", assignee: "" });
  });

  it("skips small talk and ability", () => {
    for (const s of [
      "Can you hear me?",
      "Can you see my screen?",
      "Let's get started.",
      "Let's move on to the next item.",
      "I'll be honest, it was rough.",
      "I can see it now.",
      "I think so.",
      "We'll see.",
      "Okay.",
    ]) {
      expect(actionIn(s, "others"), s).toBeNull();
    }
  });

  it("does not repeat an item, or one already on the meeting", () => {
    const lines = [
      { seq: 0, speaker: "you", text: "We need to fix the login bug." },
      { seq: 1, speaker: "others", text: "Yes, we need to fix the login bug!" },
      { seq: 2, speaker: "you", text: "Action item: write the changelog." },
    ];
    expect(findActions(lines).map((a) => a.sourceSeq)).toEqual([0, 2]);
    expect(findActions(lines, ["Write the changelog"]).map((a) => a.sourceSeq)).toEqual([0]);
  });

  it("stops at a sane number", () => {
    const lines = Array.from({ length: 40 }, (_, i) => ({ seq: i, speaker: "you", text: `We need to finish task number ${i} today.` }));
    expect(findActions(lines)).toHaveLength(MAX_ACTIONS);
  });

  it("splits sentences and tidies tasks", () => {
    expect(sentences("Okay. Ana, can you do it?  Thanks!")).toEqual(["Okay.", "Ana, can you do it?", "Thanks!"]);
    expect(tidy("please send the notes too.")).toBe("Send the notes");
  });
});
