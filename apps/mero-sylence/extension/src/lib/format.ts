/** Small formatting rules the screens share. */
import type { Line } from "./messages";

export function sizeLabel(mb: number): string {
  return mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
}

/** Whether a sign-in page override is usable: https, or http on this machine. Empty means Cloud. */
export function validOverride(value: string): boolean {
  if (!value.trim()) return true;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || (u.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Consecutive lines of one speaker within a minute read as one utterance. */
/** What a line is labelled with: the name the call page showed, else You / Others. */
export function whoLabel(line: { speaker: Line["speaker"]; name?: string }): string {
  return line.name?.trim() || (line.speaker === "you" ? "You" : "Others");
}

export function group(lines: Line[]): { speaker: Line["speaker"]; name: string; startMs: number; text: string }[] {
  const out: { speaker: Line["speaker"]; name: string; startMs: number; text: string }[] = [];
  for (const l of [...lines].sort((a, b) => a.startMs - b.startMs)) {
    const last = out[out.length - 1];
    const name = l.name ?? "";
    if (last && last.speaker === l.speaker && last.name === name && l.startMs - last.startMs < 60_000) last.text += ` ${l.text}`;
    else out.push({ speaker: l.speaker, name, startMs: l.startMs, text: l.text });
  }
  return out;
}
