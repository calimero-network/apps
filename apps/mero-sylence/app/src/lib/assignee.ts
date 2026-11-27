import { speakerColor } from "./playback";
import { speakerKey } from "./transcript";

/** Someone an action item can be given to: a speaker of the call or a workspace member, with their colour. */
export interface Assignable {
  name: string;
  color: string;
  /** Where they come from, shown in the picker. */
  source: "speaker" | "member";
}

/** The same name, however it is spaced or cased. */
export function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * The colour for `name`, picked from the name itself, so a person is the same
 * colour on every call and on the open-items page. (`_known` is kept for the
 * callers that pass the people they offer.)
 */
export function assigneeColor(name: string, _known: readonly Assignable[] = []): string {
  return speakerColor(hash(name.trim().toLowerCase()) % 7);
}

/** One or two letters: "Eve Lee" → "EL", "Speaker 2" → "S2". */
export function assigneeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

/** Speakers first, then members not already among them, each name once. */
export function assignables(speakers: readonly { name: string; color: string }[], members: readonly string[]): Assignable[] {
  const out: Assignable[] = speakers.map((s) => ({ name: s.name, color: assigneeColor(s.name), source: "speaker" as const }));
  for (const m of members) {
    if (!m.trim() || out.some((p) => sameName(p.name, m))) continue;
    out.push({ name: m, color: assigneeColor(m), source: "member" });
  }
  return out;
}

/**
 * The people who spoke in a meeting, under the names the page shows them by:
 * the name given to a label ("Speaker 1" → "Eve"), else the recorder's own
 * name for `you`, else the name the call showed. `others` with no name ("Others")
 * is no one to give work to, so it is left out.
 */
export function callSpeakers(
  meeting: { speakers?: readonly { speaker: string; name: string }[]; speakerNames: readonly { label: string; name: string }[] },
  recorderName: string,
): string[] {
  const aliases = new Map(meeting.speakerNames.map((a) => [a.label, a.name]));
  const out: string[] = [];
  for (const s of meeting.speakers ?? []) {
    const key = speakerKey(s.speaker, s.name);
    const name = aliases.get(key) || (key === "you" ? recorderName : key === "others" ? "" : key);
    if (name && !out.some((n) => sameName(n, name))) out.push(name);
  }
  return out;
}
