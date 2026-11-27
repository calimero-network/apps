import type { EmotionShare, InsightsInput, PersonInsight } from "../generated/client";
import type { SpeakerStats, TalkStats } from "./stats";

/**
 * People insights, the model-free half: how the emotion model's per-line
 * scores become a tone and emotion shares per person, which of their
 * sentences are the key points, the profile sentence, and the optional
 * Smart notes pass (prompt and parsing). Pure and deterministic;
 * `insights.test.ts` pins each part.
 */

export type Tone = "enthusiastic" | "positive" | "neutral" | "curious" | "concerned" | "frustrated";

export const TONES: readonly Tone[] = ["enthusiastic", "positive", "neutral", "curious", "concerned", "frustrated"];

/** The 28 GoEmotions labels, by the tone they read as. */
export const TONE_GROUPS: Record<string, Tone> = {
  excitement: "enthusiastic",
  joy: "enthusiastic",
  admiration: "enthusiastic",
  optimism: "enthusiastic",
  approval: "positive",
  gratitude: "positive",
  love: "positive",
  amusement: "positive",
  caring: "positive",
  pride: "positive",
  relief: "positive",
  desire: "positive",
  curiosity: "curious",
  confusion: "curious",
  realization: "curious",
  surprise: "curious",
  nervousness: "concerned",
  fear: "concerned",
  sadness: "concerned",
  disappointment: "concerned",
  remorse: "concerned",
  embarrassment: "concerned",
  grief: "concerned",
  disapproval: "concerned",
  anger: "frustrated",
  annoyance: "frustrated",
  disgust: "frustrated",
  neutral: "neutral",
};

/** The contract's limits (logic/src/lib.rs). */
export const LIMITS = {
  keyPoints: 8,
  keyPoint: 400,
  emotions: 8,
  emotion: 40,
  profile: 1_000,
  tone: 40,
  label: 100,
  model: 100,
  people: 50,
} as const;

/** Emotions kept per person. */
export const TOP_EMOTIONS = 6;

/** How much a neutral score counts against the others: most speech is neutral. */
const NEUTRAL_WEIGHT = 0.35;
/** Below this share of non-neutral mass a person reads as neutral. */
const EMOTIVE_FLOOR = 0.18;

export interface ScoredLine {
  /** Speaker label. */
  label: string;
  words: number;
  /** Emotion label → probability, as the model gave them. */
  scores: Record<string, number>;
}

export interface EmotionSummary {
  tone: Tone;
  /** Largest first, thousandths, summing to at most 1000. */
  emotions: EmotionShare[];
}

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** One person's lines → their strongest emotions (by words) and tone. */
export function aggregateEmotions(lines: readonly Omit<ScoredLine, "label">[]): EmotionSummary {
  const mass = new Map<string, number>();
  for (const line of lines) {
    const w = Math.max(1, line.words);
    for (const [label, p] of Object.entries(line.scores)) {
      if (!Number.isFinite(p) || p <= 0) continue;
      mass.set(label, (mass.get(label) ?? 0) + p * w * (label === "neutral" ? NEUTRAL_WEIGHT : 1));
    }
  }
  const total = [...mass.values()].reduce((a, b) => a + b, 0);
  if (!total) return { tone: "neutral", emotions: [] };

  const ranked = [...mass].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, TOP_EMOTIONS);
  const emotions = ranked
    .map(([label, m]) => ({ label: cut(label, LIMITS.emotion), share: Math.floor((m / total) * 1000) }))
    .filter((e) => e.share > 0);

  // Tone: the group with the most non-neutral mass, if that mass is meaningful.
  const groups = new Map<Tone, number>();
  let emotive = 0;
  for (const [label, m] of mass) {
    const g = TONE_GROUPS[label];
    if (!g || g === "neutral") continue;
    groups.set(g, (groups.get(g) ?? 0) + m);
    emotive += m;
  }
  let tone: Tone = "neutral";
  if (emotive / total >= EMOTIVE_FLOOR) {
    tone = [...groups].sort((a, b) => b[1] - a[1] || TONES.indexOf(a[0]) - TONES.indexOf(b[0]))[0]![0];
  }
  return { tone, emotions };
}

// ── Key points ──────────────────────────────────────────────────────────────

export interface TextLine {
  label: string;
  startMs: number;
  text: string;
}

export interface KeyPoint {
  text: string;
  startMs: number;
}

const STOP = new Set(
  (
    "a an the and or but if then so of to in on at for from by with about as is are was were be been being am i you he she it we they me him her us them my your our their this that these those there here " +
    "do does did done have has had will would can could should shall may might must not no yes just really very like um uh oh okay ok yeah right well also too all any some more most what which who when where why how " +
    "get got go going gonna wanna kind sort thing things lot bit maybe actually basically literally stuff know think mean say said see"
  ).split(" "),
);

const FILLER = /^(?:(?:um+|uh+|so|yeah|yes|okay|ok|right|well|like|oh|hmm+|mhm|sure|cool|great|thanks?|thank you|bye|hi|hello)[\s,.!?]*)+$/i;
const DECISION = /\b(we'll|we will|let's|let us|decided|decide|agree[ds]?|need to|needs to|plan(?:ned|ning)?|going to|will be|should|must|deadline|launch|ship|next step|action)\b/i;
const NUMBER_OR_DATE =
  /\b(\d[\d,.:%]*|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|tonight|week|month|quarter|q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** A transcript line cut into sentences. */
export function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both += 1;
  return both / (a.size + b.size - both);
}

/**
 * Up to `max` key points for one speaker, from their lines (`mine`), with the
 * whole meeting (`all`) as the background the words are weighed against. In
 * the order they were said.
 */
export function keyPoints(mine: readonly TextLine[], all: readonly TextLine[] = mine, max = 5): KeyPoint[] {
  // Document frequency over the meeting's lines.
  const df = new Map<string, number>();
  for (const l of all) for (const w of new Set(tokens(l.text))) df.set(w, (df.get(w) ?? 0) + 1);
  const n = Math.max(1, all.length);

  const candidates: { text: string; startMs: number; score: number; words: Set<string>; order: number }[] = [];
  let order = 0;
  for (const line of mine) {
    for (const raw of sentencesOf(line.text)) {
      const text = raw.trim();
      const wordCount = text.split(/\s+/).length;
      if (wordCount < 5 || FILLER.test(text)) continue;
      const ws = tokens(text);
      if (ws.length < 2) continue;
      const salience = ws.reduce((s, w) => s + Math.log(1 + n / (df.get(w) ?? 1)), 0) / Math.sqrt(ws.length);
      const length = Math.min(1, wordCount / 14) - Math.max(0, (wordCount - 45) / 45);
      let score = salience + length * 1.5;
      if (DECISION.test(text)) score += 1.6;
      if (NUMBER_OR_DATE.test(text)) score += 0.8;
      if (/\?\s*$/.test(text)) score += 0.5;
      candidates.push({ text: cut(text, LIMITS.keyPoint), startMs: line.startMs, score, words: new Set(ws), order: order++ });
    }
  }
  candidates.sort((a, b) => b.score - a.score || a.order - b.order);
  const kept: typeof candidates = [];
  for (const c of candidates) {
    if (kept.length >= max) break;
    if (kept.some((k) => jaccard(k.words, c.words) >= 0.5)) continue;
    kept.push(c);
  }
  return kept.sort((a, b) => a.order - b.order).map(({ text, startMs }) => ({ text, startMs }));
}

// ── Profile ─────────────────────────────────────────────────────────────────

const TONE_WORDS: Record<Tone, string> = {
  enthusiastic: "Enthusiastic",
  positive: "Positive",
  neutral: "Even-toned",
  curious: "Curious",
  concerned: "Concerned",
  frustrated: "Frustrated",
};

const pct = (share: number) => (share > 0 && share < 0.005 ? "under 1%" : `${Math.round(share * 100)}%`);

/**
 * One or two plain sentences on how a person came across. `rank` is their
 * place by talk time (0 = the most), `people` how many spoke.
 */
export function profileFor(
  stats: Pick<SpeakerStats, "share" | "questions" | "turns" | "longestTurnMs" | "wpm">,
  tone: Tone,
  emotions: readonly EmotionShare[],
  keyPointCount: number,
  rank = 0,
  people = 1,
): string {
  const role =
    people <= 1
      ? `did all the talking`
      : rank === 0
        ? `talked the most (${pct(stats.share)} of the meeting)`
        : rank === people - 1 && stats.share < 0.15
          ? `spoke least (${pct(stats.share)} of the meeting)`
          : `spoke ${pct(stats.share)} of the meeting`;
  const first = `${TONE_WORDS[tone]} and ${role}`;
  const details: string[] = [];
  if (stats.questions > 0) details.push(`asked ${stats.questions} question${stats.questions === 1 ? "" : "s"}`);
  if (stats.longestTurnMs >= 60_000) details.push(`held the floor for up to ${Math.round(stats.longestTurnMs / 60_000)} min at a time`);
  if (stats.wpm >= 170) details.push("spoke fast");
  const top = emotions.find((e) => e.label !== "neutral");
  if (top && top.share >= 100) details.push(`mostly ${top.label}`);
  let text = details.length ? `${first}; ${details.join(", ")}.` : `${first}.`;
  if (keyPointCount === 0 && stats.turns <= 2) text += " Said little of substance.";
  return cut(text, LIMITS.profile);
}

// ── The whole record ────────────────────────────────────────────────────────

export interface AnalyzedLine extends TextLine {
  words: number;
  /** The emotion model's scores; empty when not classified. */
  scores: Record<string, number>;
}

export interface PersonDraft extends PersonInsight {
  /** Key points with where they were said, for the page. */
  points: KeyPoint[];
}

/** Every person's insights, ordered as `stats` orders them. */
export function buildPeople(lines: readonly AnalyzedLine[], stats: TalkStats): PersonDraft[] {
  const people = stats.speakers.slice(0, LIMITS.people);
  return people.map((st, rank) => {
    const mine = lines.filter((l) => l.label === st.label);
    const { tone, emotions } = aggregateEmotions(mine);
    const points = keyPoints(mine, lines, 5);
    return {
      label: cut(st.label, LIMITS.label),
      tone,
      profile: profileFor(st, tone, emotions, points.length, rank, people.length),
      emotions: emotions.slice(0, LIMITS.emotions),
      keyPoints: points.map((p) => p.text).slice(0, LIMITS.keyPoints),
      points,
    };
  });
}

/** The contract's `InsightsInput` from drafts (drops the page-only fields, applies the caps). */
export function toInput(people: readonly PersonDraft[], model: string): InsightsInput {
  return {
    model: cut(model, LIMITS.model),
    people: people.slice(0, LIMITS.people).map((p) => ({
      label: cut(p.label, LIMITS.label),
      tone: cut(p.tone, LIMITS.tone),
      profile: cut(p.profile.trim(), LIMITS.profile),
      emotions: p.emotions.slice(0, LIMITS.emotions).map((e) => ({ label: cut(e.label, LIMITS.emotion), share: Math.max(0, Math.min(1000, Math.round(e.share))) })),
      keyPoints: p.keyPoints
        .map((k) => cut(k.trim(), LIMITS.keyPoint))
        .filter(Boolean)
        .slice(0, LIMITS.keyPoints),
    })),
  };
}

/** `buildPeople` then `toInput`, in one. */
export function buildInsights(lines: readonly AnalyzedLine[], stats: TalkStats, model: string): InsightsInput {
  return toInput(buildPeople(lines, stats), model);
}

// ── Smart notes pass ────────────────────────────────────────────────────────

/** Characters of one person's lines a prompt carries. */
export const PERSON_CHARS = 5_000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const SYSTEM = [
  "You describe one person in a meeting from the lines they said.",
  "Reply in exactly this format and nothing else:",
  "PROFILE:",
  "<one or two sentences: how they came across and what they focused on>",
  "POINTS:",
  "- <a key point they made, as a short complete sentence>",
  "List at most 5 points. The lines come from speech recognition and have mistakes: skip lines that make no sense.",
  "Never invent facts, names, numbers or dates. Write in the language of the lines.",
].join("\n");

/** The prompt for one person; `hint` is what the emotion model and stats found. */
export function llmPrompt(name: string, lines: readonly TextLine[], hint: { tone: Tone; share: number }): ChatMessage[] {
  let body = "";
  for (const l of lines) {
    const next = `- ${l.text.replace(/\s+/g, " ").trim()}\n`;
    if (body.length + next.length > PERSON_CHARS) break;
    body += next;
  }
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Person: ${name}\nTone (from an emotion model): ${hint.tone}\nShare of talk time: ${pct(hint.share)}\n\nWhat they said:\n${body}`,
    },
  ];
}

/** The model's answer read back; `null` when it is not in the format. */
export function parseLlm(text: string): { profile: string; keyPoints: string[] } | null {
  const m = /PROFILE:\s*([\s\S]*?)\s*POINTS:\s*([\s\S]*)$/i.exec(text.trim());
  if (!m) return null;
  const profile = m[1]!.replace(/\s+/g, " ").trim();
  const keyPoints = m[2]!
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((l) => l.length >= 3 && !/^none\.?$/i.test(l))
    .slice(0, LIMITS.keyPoints)
    .map((l) => cut(l, LIMITS.keyPoint));
  if (!profile) return null;
  return { profile: cut(profile, LIMITS.profile), keyPoints };
}

/** Does this action item belong to the person? Its assignee names them (any case). */
export function assignedTo(assignee: string, ...names: string[]): boolean {
  const a = assignee.trim().toLowerCase();
  if (!a) return false;
  return names.some((n) => {
    const x = n.trim().toLowerCase();
    return !!x && (a === x || a.split(/[\s,&/]+|\band\b/).includes(x) || x.split(/\s+/)[0] === a);
  });
}
