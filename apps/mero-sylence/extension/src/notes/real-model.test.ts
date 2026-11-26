// @vitest-environment node
/**
 * Opt-in: the real notes model on a sample call, through the same prompt and
 * parser the extension uses (CPU here; WebGPU in the browser).
 *   SYLENCE_LLM=small npx vitest run src/notes/real-model.test.ts
 */
import { describe, expect, it } from "vitest";
import { NOTES_MODELS, actionsToAdd, writeNotes, type NotesModelId } from "../lib/notes";

const which = process.env.SYLENCE_LLM as NotesModelId | undefined;

const call = [
  ["you", "Morning everyone, thanks for joining. Let's go through the launch plan for Sylence."],
  ["others", "Morning! I pulled the numbers from the beta, about forty teams tried it last week, mostly on Google Meet."],
  ["you", "Great. The big question from the beta was the model download on older laptops."],
  ["others", "Right, the large turbo model is too much on a slow connection, so small laptops now get Moonshine."],
  ["you", "Okay. Ana, can you write the release notes for the store listing by Thursday?"],
  ["others", "Yes, I'll have a draft by Thursday and share it in the channel."],
  ["you", "Marko, we still need someone to test Brave, the shields sometimes hide WebGPU."],
  ["others", "This is Marko, I'll test Brave on my machine today and send screenshots."],
  ["you", "Perfect. We also need a short demo video for the landing page before launch."],
  ["others", "I can record the demo on Friday once the store build is up."],
  ["you", "Great, that's everything. Thanks all, talk on Monday."],
].map(([speaker, text], seq) => ({ seq, speaker: speaker!, text: text! }));

describe.skipIf(!which)("the real notes model", () => {
  it(
    "writes a summary and the action items of a sample call",
    async () => {
      const { pipeline } = await import("@huggingface/transformers");
      const m = NOTES_MODELS[which!];
      const gen = await pipeline("text-generation", m.repo, { dtype: "q4" as never, device: "cpu" as never });
      const raw: string[] = [];
      const started = Date.now();
      const notes = await writeNotes(call, {
        generate: async (messages) => {
          const out = (await gen(messages as never, { max_new_tokens: 384, do_sample: false, repetition_penalty: 1.1 } as never)) as {
            generated_text: { role: string; content: string }[];
          }[];
          const text = out[0]!.generated_text.at(-1)!.content;
          raw.push(text);
          return text;
        },
      });
      console.log(`--- ${m.name} answered in ${Date.now() - started} ms:\n${raw.join("\n---\n")}`);
      console.log("--- parsed:", JSON.stringify(notes, null, 2));
      console.log("--- to add:", JSON.stringify(actionsToAdd(notes.actions), null, 2));
      expect(notes.actions.length).toBeGreaterThan(0);
      if (which === "better") {
        // The model Automatic picks on most laptops: a real summary and the right owners.
        expect(notes.summary.split(/\s+/).length).toBeGreaterThan(15);
        const owners = actionsToAdd(notes.actions).map((a) => a.assignee);
        expect(owners).toEqual(expect.arrayContaining(["Ana", "Marko"]));
      }
    },
    20 * 60_000,
  );
});
