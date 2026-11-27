import type { ActionView, MeetingView, SegmentView } from "../generated/client";

/**
 * Pure helpers the meeting screens share: merging transcript pages and live
 * updates, clock and duration formatting, platform names, and the Markdown
 * export. No React, no network: `transcript.test.ts` pins each.
 */

/**
 * `existing` with `incoming` laid over it: one segment per number, in number
 * order. A segment that arrives again (an edit, a re-read of a live range)
 * replaces the copy held.
 */
export function mergeSegments(existing: readonly SegmentView[], incoming: readonly SegmentView[]): SegmentView[] {
  if (incoming.length === 0) return existing as SegmentView[];
  const bySeq = new Map<number, SegmentView>();
  for (const s of existing) bySeq.set(s.seq, s);
  for (const s of incoming) bySeq.set(s.seq, s);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** `ms` into the recording as `m:ss`, or `h:mm:ss` from an hour on. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** A recording's length in words: `45 s`, `12 min`, `1 h 5 min`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The contract's timestamps travel as decimal strings (ms since the epoch). */
export function toMillis(value: string | number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** `Mon 23 Nov 2026, 14:05`, in the reader's locale. */
export function formatWhen(value: string | number, locale?: string): string {
  const ms = toMillis(value);
  if (!ms) return "";
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}

export type Platform = "meet" | "zoom" | "teams" | "upload" | "other";

const PLATFORM_NAMES: Record<Platform, string> = {
  meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  upload: "Uploaded recording",
  other: "Call",
};

export function asPlatform(value: string): Platform {
  return value === "meet" || value === "zoom" || value === "teams" || value === "upload" ? value : "other";
}

export function platformName(value: string): string {
  return PLATFORM_NAMES[asPlatform(value)];
}

/**
 * Who spoke a segment, as the transcript labels it: the name the call page
 * showed when the extension read one, else the recorder for their microphone
 * and "Others" for the call.
 */
export function speakerLabel(speaker: string, recorderName: string, name = ""): string {
  // Early extension builds saved Meet's name twice ("Eve ParkerEve Parker").
  const n = name.replace(/\s+/g, " ").trim().replace(/^(.{2,}?)\s*\1$/u, "$1");
  return n || (speaker === "you" ? recorderName : "Others");
}

/**
 * A speaker's stable key: the name the call page showed (cleaned as in
 * `speakerLabel`), else `you` or `others`. Unlike the label it does not depend
 * on who is reading, so speaker names and insights are saved under it.
 */
export function speakerKey(speaker: string, name = ""): string {
  const n = name.replace(/\s+/g, " ").trim().replace(/^(.{2,}?)\s*\1$/u, "$1");
  return n || (speaker === "you" ? "you" : "others");
}

/** How a speaker key reads: the name given to it, else the recorder for `you`, "Others" for `others`. */
export function keyName(key: string, recorderName: string, aliases?: ReadonlyMap<string, string>): string {
  const alias = aliases?.get(key);
  if (alias) return alias;
  if (key === "you") return recorderName;
  if (key === "others") return "Others";
  return key;
}

/** The speakers in `segments`, in the order they first spoke, with their line counts. */
export function speakersIn(
  segments: readonly Pick<SegmentView, "speaker" | "name">[],
  recorderName: string,
): { label: string; lines: number }[] {
  const counts = new Map<string, number>();
  for (const s of segments) {
    const label = speakerLabel(s.speaker, recorderName, s.name);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, lines]) => ({ label, lines }));
}

/** Meetings whose title holds every word of `query` (any case, any order). */
/** The words of a search, lowercased; empty when there is nothing to look for. */
export function queryWords(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when `text` contains every word (any case), as the contract's `search` matches. */
export function matchesAll(text: string, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const t = text.toLowerCase();
  return words.every((w) => t.includes(w));
}

/** `text` cut into plain and matching parts, for <mark>. */
export function highlightParts(text: string, words: readonly string[]): { text: string; hit: boolean }[] {
  const ws = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (ws.length === 0) return [{ text, hit: false }];
  const re = new RegExp(`(${ws.sort((a, b) => b.length - a.length).join("|")})`, "gi");
  return text
    .split(re)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: ws.some((w) => new RegExp(`^${w}$`, "i").test(part)) }));
}

export function searchMeetings<T extends Pick<MeetingView, "title">>(meetings: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return meetings as T[];
  return meetings.filter((m) => {
    const title = m.title.toLowerCase();
    return words.every((w) => title.includes(w));
  });
}

/**
 * The meeting as a Markdown document: title, when and where, summary, action
 * items as a checklist, then the transcript with a timestamp and speaker per
 * line. `recorderName` names the recorder's own microphone ("You" segments).
 */
export function toMarkdown(
  meeting: Pick<MeetingView, "title" | "platform" | "startedAt" | "durationMs" | "summary">,
  segments: readonly SegmentView[],
  actions: readonly Pick<ActionView, "text" | "assignee" | "done">[],
  recorderName: string,
  locale = "en-GB",
  /** The name given to a speaker label, if any. */
  nameOf: (label: string) => string = (label) => label,
): string {
  const lines: string[] = [`# ${meeting.title}`, ""];
  const when = formatWhen(meeting.startedAt, locale);
  const meta = [when, platformName(meeting.platform), meeting.durationMs ? formatDuration(meeting.durationMs) : ""]
    .filter(Boolean)
    .join(" · ");
  if (meta) lines.push(meta, "");
  if (meeting.summary.trim()) lines.push("## Summary", "", meeting.summary.trim(), "");
  if (actions.length) {
    lines.push("## Action items", "");
    for (const a of actions) {
      lines.push(`- [${a.done ? "x" : " "}] ${a.text}${a.assignee ? ` (${a.assignee})` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Transcript", "");
  if (segments.length === 0) lines.push("_No transcript yet._");
  for (const s of segments) {
    lines.push(`**${formatClock(s.startMs)} ${nameOf(speakerLabel(s.speaker, recorderName, s.name))}:** ${s.text}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** A file name for the export: the title in lowercase words, `.md`. */
export function markdownFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "meeting"}.md`;
}

/** Segments one transcript read asks for. */
export const PAGE = 200;

/**
 * What to re-read after `TranscriptChanged { from, to }`: the changed numbers,
 * when the page holds them or holds everything up to the end (`loadedTo` is
 * the next page's `fromSeq`, `null` once the last page is in). A change past
 * what is loaded comes with the next page anyway, so nothing is read for it.
 */
export function rangeToRead(change: { from: number; to: number }, loadedTo: number | null): { fromSeq: number; limit: number } | null {
  if (change.to <= change.from) return null;
  if (loadedTo !== null && change.from >= loadedTo) return null;
  const to = loadedTo === null ? change.to : Math.min(change.to, loadedTo);
  return { fromSeq: change.from, limit: Math.min(500, Math.max(1, to - change.from)) };
}
