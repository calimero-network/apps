import type { SegmentView } from "../generated/client";

/**
 * Who talked, and how much: per speaker label, from the transcript alone.
 * Pure; `stats.test.ts` pins it.
 *
 * A turn is a run of lines by one speaker; a pause of `gapMs` or more inside
 * the run still counts as the same turn (people pause mid-thought).
 */

export interface SpeakerStats {
  /** The speaker label (`speakerLabel`), before any name given to it. */
  label: string;
  /** Milliseconds of speech. */
  talkMs: number;
  /** Share of all speech, 0–1. */
  share: number;
  words: number;
  lines: number;
  turns: number;
  /** The longest single turn, ms. */
  longestTurnMs: number;
  /** Words per minute of their own speech; 0 below 10 s of it. */
  wpm: number;
  /** Lines ending in a question mark. */
  questions: number;
  /** When they first spoke, ms into the meeting. */
  firstMs: number;
}

export interface TalkStats {
  speakers: SpeakerStats[];
  /** All speech, ms (overlaps counted once per speaker). */
  totalTalkMs: number;
  totalWords: number;
}

type Line = Pick<SegmentView, "startMs" | "endMs" | "text">;

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Talk stats for `segments`, biggest talker first; `labelOf` names a line's speaker. */
export function talkStats<T extends Line>(segments: readonly T[], labelOf: (s: T) => string): TalkStats {
  const by = new Map<string, SpeakerStats & { turnStart: number; turnEnd: number }>();
  let previous: string | null = null;
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);
  for (const s of ordered) {
    const label = labelOf(s);
    const ms = Math.max(0, s.endMs - s.startMs);
    let st = by.get(label);
    if (!st) {
      st = {
        label,
        talkMs: 0,
        share: 0,
        words: 0,
        lines: 0,
        turns: 0,
        longestTurnMs: 0,
        wpm: 0,
        questions: 0,
        firstMs: s.startMs,
        turnStart: s.startMs,
        turnEnd: s.endMs,
      };
      by.set(label, st);
    }
    st.talkMs += ms;
    st.words += words(s.text);
    st.lines += 1;
    if (/\?\s*$/.test(s.text)) st.questions += 1;
    if (previous !== label) {
      st.turns += 1;
      st.turnStart = s.startMs;
    }
    st.turnEnd = Math.max(st.turnEnd, s.endMs);
    st.longestTurnMs = Math.max(st.longestTurnMs, st.turnEnd - st.turnStart);
    previous = label;
  }
  const speakers = [...by.values()].map(({ turnStart: _s, turnEnd: _e, ...st }) => st);
  const totalTalkMs = speakers.reduce((n, s) => n + s.talkMs, 0);
  const totalWords = speakers.reduce((n, s) => n + s.words, 0);
  for (const s of speakers) {
    s.share = totalTalkMs ? s.talkMs / totalTalkMs : 0;
    s.wpm = s.talkMs >= 10_000 ? Math.round(s.words / (s.talkMs / 60_000)) : 0;
  }
  speakers.sort((a, b) => b.talkMs - a.talkMs || a.firstMs - b.firstMs);
  return { speakers, totalTalkMs, totalWords };
}

/** `0.4234` → `42%`; under half a percent shows as `<1%`. */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) return "<1%";
  return `${Math.round(share * 100)}%`;
}
