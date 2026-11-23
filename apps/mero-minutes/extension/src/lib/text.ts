/**
 * What the models write for silence, music and noise, rather than speech:
 * bracketed tags, and Whisper's well-known phantom sign-offs on quiet audio.
 */
const TAG = /^\s*[[(（【][^\])）】]*[\])）】]\s*$/;
const PHANTOMS = [
  /^thanks? (you )?(so much )?for watching[.!]?$/i,
  /^please subscribe[.!]?$/i,
  /^subtitles by .*$/i,
  /^\.+$/,
  /^you$/i,
];

/** The text worth keeping from a model's answer, or "" for none. */
export function cleanTranscript(text: string): string {
  let t = text.replace(/\s+/g, " ").trim();
  // Tags inside a line ("[MUSIC] hello") are dropped, the words kept.
  t = t.replace(/\s*\[(?:BLANK_AUDIO|MUSIC|NOISE|SILENCE|INAUDIBLE|APPLAUSE|LAUGHTER)\]\s*/gi, " ").trim();
  if (!t || TAG.test(t)) return "";
  if (PHANTOMS.some((p) => p.test(t))) return "";
  return t;
}

/** Download progress over every file of a model: 0–1, and the file still loading. */
export function aggregateProgress(files: Map<string, { loaded: number; total: number }>): { fraction: number; file: string } {
  let loaded = 0;
  let total = 0;
  let file = "";
  for (const [name, f] of files) {
    loaded += Math.min(f.loaded, f.total);
    total += f.total;
    if (f.loaded < f.total) file = name;
  }
  return { fraction: total > 0 ? loaded / total : 0, file };
}
