/**
 * Action items found in a transcript, on this laptop, with no model: the
 * phrasings people use in calls when they ask for something, take something
 * on, or agree the team will do it.
 *
 *   "Ana, can you write the release notes by Thursday?"  → Ana: Write the release notes by Thursday
 *   "I'll test Brave on my machine today."              → Test Brave on my machine today
 *   "We need to record a demo video."                    → Record a demo video
 *   "Action item: update the pricing page."              → Update the pricing page
 *
 * It errs on the side of fewer items: small talk ("can you hear me", "let's
 * get started") is skipped, and the team edits or removes items on the page.
 */

export interface TranscriptLine {
  seq: number;
  speaker: string;
  text: string;
}

export interface FoundAction {
  text: string;
  /** A name said in the line ("Ana, can you…"), or "". */
  assignee: string;
  sourceSeq: number;
}

/** At most this many per meeting; past it, phrasings are rarely real tasks. */
export const MAX_ACTIONS = 12;

const MIN_WORDS = 3;
const MAX_CHARS = 160;

/** Requests and plans that are about the call itself, not work. */
const SMALL_TALK =
  /\b(hear me|see me|see my screen|hear you|share (my|your) screen|mute|unmute|camera|repeat that|say that again|get started|kick off|go ahead|wrap up|move on|look at|go through|start with|begin|talk (about|later)|take a look at (the|this) (slide|screen)|give (me|us) a (second|minute|sec))\b/i;

/** "I'll …", "I will …", "I'm going to …", "I can … by/today/…" */
const COMMIT = /^i(?:'ll| will| am going to|'m going to| can)\s+(.+)$/i;

/** "Ana, can you …", "can you …", "could you please …" */
const REQUEST = /^(?:([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s+)?(?:[Cc]an|[Cc]ould|[Ww]ould|[Ww]ill)\s+you(?:\s+please)?\s+(.+?)\??$/;

/** "Ana, please …" or "Ana, you'll …" */
const NAMED_ASK = /^([A-Z][a-z]+),\s+(?:please\s+|you(?:'ll| will| need to| should)\s+)(.+)$/;

/** "We need to …", "we should …", "let's …", "someone needs to …" */
const TEAM =
  /^(?:we(?:'ll| will| need to| have to| should| must|'ve got to)|let's|lets|someone (?:needs|has) to|somebody (?:needs|has) to)\s+(.+)$/i;

/** "We need a demo video", "we still need the Brave check": kept whole. */
const TEAM_NEED = /^we(?: still)? need (?:a|an|the|some|to have)\s+.+$/i;

/** Openers before the part that matters: "Okay, so", "Last thing,", "Perfect." */
const LEAD =
  /^(?:(?:ok(?:ay)?|so|and|also|then|great|perfect|right|yes|yeah|sure|alright|cool|good|last thing|one more thing|finally|anyway|oh),?\s+)+/i;

/** "Action item: …", "TODO …", "next step is to …", "follow up on …", "don't forget to …" */
const EXPLICIT =
  /^(?:action item|todo|to-do|next steps?(?: is| are)?(?: to)?|follow[- ]up(?: on| with)?|don't forget to|do not forget to|remember to|make sure (?:to|that|we|you)?)\s*[:,-]?\s*(.+)$/i;

/** Words a commitment can start with that are not tasks ("I'll be honest", "I can see it"). */
const NOT_A_TASK =
  /^(be |see |hear |think |guess |say |tell you |try to remember|probably |just |definitely |go ahead|leave it|let you|pass|stop sharing|share my screen)/i;

/** Splits on sentence ends, keeping "e.g." and decimals. */
export function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The task, tidied: first letter up, filler and closing punctuation off. */
export function tidy(task: string): string {
  let t = task
    .trim()
    .replace(/^(please|also|then|maybe|just|quickly|actually)\s+/i, "")
    .replace(/\s*(please|for me|for us|as well|too)\s*[.!?]*$/i, "")
    .replace(/[\s.,;:!?]+$/, "");
  // "send it over to me" reads as the speaker's; keep, but trim a trailing "okay?"
  t = t.replace(/,?\s+(okay|ok|right|yeah|alright)$/i, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function words(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function key(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(the|a|an|to|by|on|for|of)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The action in one sentence, or null. */
export function actionIn(sentence: string, speaker: string): Omit<FoundAction, "sourceSeq"> | null {
  const s = sentence.trim().replace(LEAD, "");
  if (SMALL_TALK.test(s)) return null;

  let task: string | null = null;
  let assignee = "";

  // "Marko, we still need …": the name is who it is for.
  const addressed = /^([A-Z][a-z]+),\s+(?=[a-z])/.exec(s);
  const rest = addressed ? s.slice(addressed[0].length) : s;
  const explicit = EXPLICIT.exec(rest);
  const named = NAMED_ASK.exec(s);
  const request = REQUEST.exec(s);
  const commit = COMMIT.exec(s);
  const team = TEAM.exec(rest);
  const need = TEAM_NEED.exec(rest);

  if (explicit) {
    task = explicit[1]!;
    assignee = addressed?.[1] ?? "";
  } else if (named) {
    assignee = named[1]!;
    task = named[2]!;
  } else if (request) {
    // A question back about the call ("can you send the link?") is still a task.
    assignee = request[1] ?? "";
    task = request[2]!;
  } else if (commit) {
    if (NOT_A_TASK.test(commit[1]!)) return null;
    // "I can …" is an offer only when a time is given; otherwise it is ability.
    if (/^i can\s/i.test(s) && !/\b(by|today|tomorrow|tonight|this week|next week|monday|tuesday|wednesday|thursday|friday|later|after)\b/i.test(s)) {
      return null;
    }
    // Who "I" is depends on who reads it; the page shows who recorded it.
    void speaker;
    task = commit[1]!.replace(/^take care of\s+/i, "");
  } else if (team) {
    task = team[1]!;
    assignee = addressed?.[1] ?? "";
  } else if (need) {
    task = need[0];
    assignee = addressed?.[1] ?? "";
  }
  if (!task) return null;
  const text = tidy(task);
  if (words(text) < MIN_WORDS || text.length > MAX_CHARS) return null;
  if (NOT_A_TASK.test(text)) return null;
  if (SMALL_TALK.test(text)) return null;
  return { text, assignee };
}

/** Every action item in `lines`, in order, without repeats, at most `MAX_ACTIONS`. */
export function findActions(lines: TranscriptLine[], existing: string[] = []): FoundAction[] {
  const seen = new Set(existing.map(key));
  const out: FoundAction[] = [];
  for (const line of lines) {
    for (const sentence of sentences(line.text)) {
      const found = actionIn(sentence, line.speaker);
      if (!found) continue;
      const k = key(found.text);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ ...found, sourceSeq: line.seq });
      if (out.length >= MAX_ACTIONS) return out;
    }
  }
  return out;
}
