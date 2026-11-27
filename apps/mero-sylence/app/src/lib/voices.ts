import { assignSpeakers, type Turn } from "./upload";

/** A saved line, as far as telling voices apart goes. */
export interface VoiceLine {
  seq: number;
  speaker: string;
  name?: string;
  startMs: number;
  endMs: number;
}

/** The lines no one is named on: "others" from a call whose page showed no names. */
export function unnamedLines<T extends Pick<VoiceLine, "speaker" | "name">>(lines: readonly T[]): T[] {
  return lines.filter((l) => l.speaker === "others" && !(l.name ?? "").trim());
}

/** Whether a meeting is worth telling voices apart: it has its recording, and lines with no one named. */
export function canTellVoices(meeting: { audio: unknown } | null | undefined, lines: readonly Pick<VoiceLine, "speaker" | "name">[]): boolean {
  return !!meeting?.audio && unnamedLines(lines).length > 0;
}

/**
 * Each unnamed line named after the voice that overlaps it most, the voices
 * numbered by who spoke first: "Voice 1", "Voice 2", … A line no voice reaches
 * (silence, or no turns at all) is left as it was.
 */
export function voiceNames(lines: readonly VoiceLine[], turns: readonly Turn[]): { seq: number; name: string }[] {
  const unnamed = [...unnamedLines(lines)].sort((a, b) => a.startMs - b.startMs);
  if (!unnamed.length || !turns.length) return [];
  const spoken = assignSpeakers(
    unnamed.map((l) => ({ start: l.startMs / 1000, end: l.endMs / 1000, text: "" })),
    turns,
  );
  const order = new Map<number, number>();
  const out: { seq: number; name: string }[] = [];
  spoken.forEach((s, i) => {
    if (s.speakerIndex < 0) return;
    if (!order.has(s.speakerIndex)) order.set(s.speakerIndex, order.size + 1);
    out.push({ seq: unnamed[i]!.seq, name: `Voice ${order.get(s.speakerIndex)}` });
  });
  return out;
}

/** `items` in runs of `size`: the contract names at most 500 lines a call. */
export function inRuns<T>(items: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
