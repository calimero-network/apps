/**
 * A card's monogram: up to two initials, and a hue that is the same for the
 * same name on every device, so a workspace keeps its colour wherever it is
 * opened. Purely presentational.
 */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/[\s\-_.—]+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (words.length === 0) return '·';
  const first = [...words[0]][0] ?? '';
  const second = words.length > 1 ? ([...words[1]][0] ?? '') : '';
  return (first + second).toUpperCase();
}

export function hueOf(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h % 360;
}
