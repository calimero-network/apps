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
  /** Who said it, from the call page; "" or missing when unknown. */
  name?: string;
  text: string;
  startMs?: number;
  endMs?: number;
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


/** Openers before the part that matters: "Okay, so", "Last thing,", "Perfect." */
const LEAD =
  /^(?:(?:ok(?:ay)?|so|and|also|then|great|perfect|right|yes|yeah|sure|alright|cool|good|last thing|one more thing|finally|anyway|oh),?\s+)+/i;

/** "Action item: …", "TODO …", "next step is to …", "follow up on …", "don't forget to …" */
const EXPLICIT =
  /^(?:action item|todo|to-do|next steps?(?: is| are)?(?: to)?|follow[- ]up(?: on| with)?|don't forget to|do not forget to|remember to|make sure (?:to|that|we|you)?)\s*[:,-]?\s*(.+)$/i;

/** Words a commitment can start with that are not tasks ("I'll be honest", "I can see it"). */
const NOT_A_TASK =
  /^(be |see |hear |think |guess |say |tell you |try to remember|probably |just |definitely |go ahead|leave it|let you|pass|stop sharing|share my screen)/i;

/**
 * Words a task starts with. A task is something to do, so it opens with a
 * verb; anything else ("We need a way…", "Have a branch…", "Say, can you
 * say") is talk, not a task. Deliberately leaves out verbs that are mostly
 * filler in speech (have, do, be, say, see, go, think, know, need).
 */
export const TASK_VERBS = new Set(
  (
    "add address adjust agree analyse analyze announce answer apply approve archive arrange ask assign attach audit automate " +
    "back-up backup book brief build buy calculate call cancel change chase check clarify clean close collect commit compare " +
    "complete configure confirm connect contact convert copy cover create debug decide define delete deliver demo deploy describe " +
    "design document double-check download draft drop edit email enable estimate evaluate explain export extend fetch file " +
    "fill finalise finalize find finish fix follow forward gather generate get give handle hire host identify implement import " +
    "improve include inform install integrate interview introduce investigate invite invoice issue join label launch lead list " +
    "load lock log look make map mark measure meet mention merge message migrate monitor move notify onboard open order " +
    "organise organize outline own pay pick ping plan polish post prepare present price print prioritise prioritize produce " +
    "promote propose prototype provide publish pull purchase push put raise reach read rebuild record reduce refactor refund " +
    "register reject release remind remove rename renew reorganize repair replace reply report request research reschedule " +
    "resolve respond restart restore resubmit return review revise rewrite rollout run schedule scope screen send set setup " +
    "share ship show sign simplify sketch sort source specify split start submit summarise summarize support swap switch sync " +
    "take talk tell test think-through track train transfer translate triage try turn update upgrade upload validate verify " +
    "visit wrap write"
  ).split(" "),
);

/** Words a task cannot end on: the sentence was cut off ("Check if you", "Send it to"). */
const DANGLING = /\b(you|it|this|that|these|those|to|if|and|or|but|the|a|an|of|for|with|at|in|on|about|so|say|like|um|uh)$/i;

/** True for text that reads as a task: a verb first, an object, a sane length, not cut off. */
export function isTask(text: string): boolean {
  const t = text.trim().replace(/[.!]+$/, "");
  if (!t || /\?$/.test(t)) return false;
  const ws = t.split(/\s+/);
  if (ws.length < 3 || ws.length > 30) return false;
  if (!TASK_VERBS.has(ws[0]!.toLowerCase().replace(/[^a-z-]/g, ""))) return false;
  if (DANGLING.test(t.replace(/\s*\([^)]*\)$/, ""))) return false;
  // Title Case is a heading ("Release Notes for Store Listing"), not an instruction.
  const rest = ws.slice(1).filter((w) => w.length > 3);
  if (rest.length >= 2 && rest.filter((w) => /^[A-Z]/.test(w)).length / rest.length > 0.6) return false;
  // At least two real words after the verb ("Check it" is not a task).
  return ws.slice(1).filter((w) => w.replace(/[^a-z]/gi, "").length >= 3).length >= 2;
}

/**
 * One person's speech, as sentences: the speech detector cuts at pauses, so a
 * sentence often spans two or three lines. Lines of the same speaker less
 * than `gapMs` apart are joined, then split at sentence ends; each sentence
 * remembers the line it starts in.
 */
export function utterances(lines: readonly TranscriptLine[], gapMs = 1_500): { seq: number; speaker: string; name: string; text: string }[] {
  const out: { seq: number; speaker: string; name: string; text: string }[] = [];
  let group: TranscriptLine[] = [];
  const flush = () => {
    if (group.length === 0) return;
    // Character offset where each line starts, to give a sentence its line.
    let text = "";
    const starts: { at: number; seq: number }[] = [];
    for (const l of group) {
      const piece = l.text.replace(/\s+/g, " ").trim();
      if (!piece) continue;
      if (text) text += " ";
      starts.push({ at: text.length, seq: l.seq });
      text += piece;
    }
    let from = 0;
    for (const sentence of sentences(text)) {
      const at = text.indexOf(sentence, from);
      from = at + sentence.length;
      const seq = [...starts].reverse().find((st) => st.at <= at)?.seq ?? group[0]!.seq;
      out.push({ seq, speaker: group[0]!.speaker, name: group[0]!.name ?? "", text: sentence });
    }
    group = [];
  };
  for (const line of lines) {
    const prev = group.at(-1);
    const near =
      prev !== undefined &&
      prev.speaker === line.speaker &&
      (prev.name ?? "") === (line.name ?? "") &&
      (prev.endMs === undefined || line.startMs === undefined || line.startMs - prev.endMs <= gapMs);
    if (!near) flush();
    group.push(line);
  }
  flush();
  return out;
}

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
export function actionIn(sentence: string, speaker: string, name = ""): Omit<FoundAction, "sourceSeq"> | null {
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
    // "I" is whoever said it: their name when the call page showed it; without
    // one, who "I" is depends on who reads it (the page shows who recorded it).
    void speaker;
    assignee = name;
    task = commit[1]!.replace(/^take care of\s+/i, "");
  } else if (team) {
    task = team[1]!;
    assignee = addressed?.[1] ?? "";
  }
  if (!task) return null;
  const text = tidy(task);
  if (words(text) < MIN_WORDS || text.length > MAX_CHARS) return null;
  if (NOT_A_TASK.test(text)) return null;
  if (SMALL_TALK.test(text)) return null;
  if (!isTask(text)) return null;
  return { text, assignee };
}

/** Every action item in `lines`, in order, without repeats, at most `MAX_ACTIONS`. */
export function findActions(lines: TranscriptLine[], existing: string[] = []): FoundAction[] {
  const seen = new Set(existing.map(key));
  const out: FoundAction[] = [];
  for (const sentence of utterances(lines)) {
    const found = actionIn(sentence.text, sentence.speaker, sentence.name);
    if (!found) continue;
    const k = key(found.text);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...found, sourceSeq: sentence.seq });
    if (out.length >= MAX_ACTIONS) return out;
  }
  return out;
}
