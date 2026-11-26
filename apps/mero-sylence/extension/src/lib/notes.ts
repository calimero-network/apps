/**
 * Meeting notes written on this laptop by a small language model (Qwen2.5
 * Instruct, through transformers.js on WebGPU): a short summary and the action
 * items, each with who and by when. The transcript never leaves the device.
 *
 * This file is the model-free half: which models, how a transcript is cut to
 * fit, what the model is asked, and how its answer is read back. Small models
 * keep a fixed line format far better than JSON, so that is what they are
 * asked for:
 *
 *   SUMMARY:
 *   Two to four sentences.
 *   ACTION ITEMS:
 *   - Send the deck to the design team | Eve | Friday
 *   - Book the venue | - | -
 */
import { MAX_ACTIONS, isTask, type TranscriptLine } from "./actionItems";

export type NotesModelId = "small" | "better";
export type NotesSetting = NotesModelId | "auto" | "off";

export interface NotesModel {
  name: string;
  repo: string;
  dtype: string;
  sizeMb: number;
  /** Below this much memory (navigator.deviceMemory, GB) the model is not offered. */
  minMemoryGb: number;
  blurb: string;
}

export const NOTES_MODELS: Record<NotesModelId, NotesModel> = {
  small: {
    name: "Qwen2.5 0.5B",
    repo: "onnx-community/Qwen2.5-0.5B-Instruct",
    dtype: "q4f16",
    sizeMb: 483,
    minMemoryGb: 4,
    blurb: "For laptops with less memory. Shorter, rougher notes.",
  },
  better: {
    name: "Qwen2.5 1.5B",
    repo: "onnx-community/Qwen2.5-1.5B-Instruct",
    dtype: "q4f16",
    sizeMb: 1221,
    minMemoryGb: 8,
    blurb: "Good summaries and owners. Needs 8 GB of memory.",
  },
};

export interface NoteAction {
  text: string;
  assignee: string;
  due: string;
}

export interface Notes {
  summary: string;
  actions: NoteAction[];
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Characters of transcript per request: enough context, and a few seconds each on a laptop GPU. */
export const CHUNK_CHARS = 6_000;
export const MAX_NEW_TOKENS = 384;

const SYSTEM = [
  "You write meeting notes from a call transcript.",
  "Reply in exactly this format and nothing else:",
  "SUMMARY:",
  "<two to four sentences: what was discussed and decided>",
  "ACTION ITEMS:",
  "- <task, starting with a verb> | <who does it, or -> | <when it is due, or ->",
  "List only real tasks someone agreed to do or was asked to do: at most 8, each a complete instruction that starts with a verb.",
  "The transcript comes from speech recognition and has mistakes: skip lines that make no sense. Never invent tasks, names, dates, times or places.",
  "Use the names said in the call for who. If nobody is named, write -.",
  "If there are no tasks, write one line: - none",
].join("\n");

/**
 * The line's speaker for the model: the name the call page showed, else "Me"
 * (the recorder's microphone) or "Others" (everyone else in the call).
 */
function speakerName(speaker: string, name?: string): string {
  const n = name?.replace(/[:\n]/g, " ").trim();
  if (n) return n;
  return speaker === "you" ? "Me" : "Others";
}

/** The transcript as `Speaker: text` lines, cut into pieces of at most `max` characters (a line is never split). */
export function chunkTranscript(lines: readonly TranscriptLine[], max = CHUNK_CHARS): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const row = `${speakerName(line.speaker, line.name)}: ${text.slice(0, max)}\n`;
    if (current && current.length + row.length > max) {
      chunks.push(current.trimEnd());
      current = "";
    }
    current += row;
  }
  if (current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

/** One worked example: small models follow a format they have just seen far better than one described. */
const EXAMPLE_TRANSCRIPT = [
  "Me: Okay, quick sync on the pricing page.",
  "Others: The new design is done, we just need the copy.",
  "Me: Sara, can you write the copy by Wednesday?",
  "Others: Sure, I'll send it Wednesday morning.",
  "Me: And I'll book the photographer next week.",
  "Others: Great, nothing else from me.",
].join("\n");
const EXAMPLE_NOTES = [
  "SUMMARY:",
  "The new pricing page design is finished and only the copy is missing. Sara will write it and the photographer still needs booking.",
  "ACTION ITEMS:",
  "- Write the pricing page copy | Sara | Wednesday",
  "- Book the photographer | Me | next week",
].join("\n");

export function notesPrompt(chunk: string, part?: { index: number; of: number }): ChatMessage[] {
  const which = part && part.of > 1 ? ` (part ${part.index + 1} of ${part.of})` : "";
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `Transcript:\n${EXAMPLE_TRANSCRIPT}` },
    { role: "assistant", content: EXAMPLE_NOTES },
    { role: "user", content: `Transcript${which}:\n${chunk}` },
  ];
}

/** Several parts' summaries into one. */
export function combinePrompt(summaries: readonly string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: "You combine partial summaries of one meeting into a single summary of three to five sentences. Reply with the summary only.",
    },
    { role: "user", content: summaries.map((s, i) => `Part ${i + 1}: ${s}`).join("\n") },
  ];
}

const EMPTY = /^(-|none|n\/a|na|nobody|no one|unknown|unassigned|tbd|not (specified|mentioned|given))$/i;
/** Speaker labels and groups, not people: no assignee. */
const NOBODY_IN_PARTICULAR = /^(me|i|myself|you|others|other|everyone|all|team|the team|we|us|someone|somebody)$/i;

function clean(field: string | undefined): string {
  const v = (field ?? "")
    .replace(/^[*_`"']+|[*_`"']+$/g, "")
    .replace(/^(owner|who|due|when|by)\s*:\s*/i, "")
    .trim();
  return EMPTY.test(v) ? "" : v;
}

/** The model's answer read back; tolerant of bullets, numbering, bold and missing fields. */
export function parseNotes(answer: string): Notes {
  const text = answer.replace(/\r/g, "");
  const summaryMatch = /summary\s*:?\s*\**\s*\n?([\s\S]*?)(?=\n\s*\**\s*action items|$)/i.exec(text);
  const summary = (summaryMatch?.[1] ?? "")
    .split("\n")
    .map((l) => l.replace(/^[-*\s]+/, "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  const actionsAt = text.search(/action items\s*:?/i);
  const actions: NoteAction[] = [];
  if (actionsAt >= 0) {
    for (const raw of text.slice(actionsAt).split("\n").slice(1)) {
      const line = raw.trim();
      if (!/^([-*•]|\d+[.)])\s+/.test(line)) {
        if (actions.length > 0 && line === "") break;
        continue;
      }
      const body = line.replace(/^([-*•]|\d+[.)])\s+/, "").replace(/\*\*/g, "");
      if (EMPTY.test(body.trim()) || /^none\b/i.test(body.trim())) continue;
      const [task, who, due] = body.split("|").map((p) => p.trim());
      const t = clean(task).replace(/[.;]+$/, "");
      if (!t) continue;
      // "You (I)", "Eve (Guest)": the name without what the model or the call adds in brackets.
      const assignee = clean(who).replace(/\s*\([^)]*\)\s*/g, " ").trim();
      actions.push({ text: t, assignee: NOBODY_IN_PARTICULAR.test(assignee) ? "" : assignee, due: clean(due) });
    }
  }
  return { summary, actions };
}

function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(the|a|an|to|by|on|for|of)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const DAYS = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

/** "Thursday" → "by Thursday", "Before Launch" → "before launch", "today" → "by today". */
export function dueWords(due: string): string {
  let d = due.trim().replace(/[.;]+$/, "");
  if (!d) return "";
  const before = /^before\s+/i.test(d);
  d = d.replace(/^(by|on|until|before|due)\s+/i, "");
  if (!DAYS.test(d)) d = d.charAt(0).toLowerCase() + d.slice(1);
  else d = d.charAt(0).toUpperCase() + d.slice(1);
  return `${before ? "before" : "by"} ${d}`;
}

/**
 * The actions to add: each task once (also against `existing`), its due date
 * in the text when the task does not already say it, sane lengths, at most
 * `MAX_ACTIONS`. The contract keeps a task and an assignee; the due date
 * travels in the task's words.
 */
export function actionsToAdd(found: readonly NoteAction[], existing: readonly string[] = []): { text: string; assignee: string }[] {
  const seen = new Set(existing.map(key));
  const out: { text: string; assignee: string }[] = [];
  for (const a of found) {
    let text = a.text.charAt(0).toUpperCase() + a.text.slice(1);
    const due = dueWords(a.due);
    if (due && !text.toLowerCase().includes(due.replace(/^(by|before) /, "").toLowerCase())) text = `${text} (${due})`;
    if (!isTask(text) || text.length > 300) continue;
    const k = key(text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ text: text.slice(0, 500), assignee: a.assignee.slice(0, 100) });
    if (out.length >= MAX_ACTIONS) break;
  }
  return out;
}

/** Which model a laptop runs, or null: the setting, WebGPU (no GPU, no notes), and enough memory. */
export function notesModelFor(setting: NotesSetting, caps: { webgpu: boolean; deviceMemoryGb: number }): NotesModelId | null {
  if (setting === "off" || !caps.webgpu) return null;
  const memory = caps.deviceMemoryGb || 4;
  const roomy = memory >= NOTES_MODELS.better.minMemoryGb;
  if (setting === "auto") return roomy ? "better" : "small";
  if (setting === "better" && !roomy) return "small";
  return setting;
}

/** What `writeNotes` needs from the model: load it, then answer prompts. */
export interface NotesRunner {
  generate: (messages: ChatMessage[]) => Promise<string>;
}

/**
 * The notes for a transcript: each part asked for its summary and tasks, then
 * (with more than one part) the part summaries combined into one.
 * `onPart(done, of)` reports progress.
 */
export async function writeNotes(
  lines: readonly TranscriptLine[],
  runner: NotesRunner,
  onPart?: (done: number, of: number) => void,
): Promise<Notes> {
  const chunks = chunkTranscript(lines);
  if (chunks.length === 0) return { summary: "", actions: [] };
  const parts: Notes[] = [];
  for (const [index, chunk] of chunks.entries()) {
    parts.push(parseNotes(await runner.generate(notesPrompt(chunk, { index, of: chunks.length }))));
    onPart?.(index + 1, chunks.length);
  }
  const summaries = parts.map((p) => p.summary).filter(Boolean);
  let summary = summaries[0] ?? "";
  if (summaries.length > 1) {
    const combined = (await runner.generate(combinePrompt(summaries))).replace(/^summary\s*:\s*/i, "").trim();
    summary = combined || summaries.join(" ");
  }
  return { summary: summary.slice(0, 4_000), actions: parts.flatMap((p) => p.actions) };
}
