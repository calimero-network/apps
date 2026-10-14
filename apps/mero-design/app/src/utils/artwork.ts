/**
 * Generated colours and letters for teams and projects (components/Artwork,
 * the Teams page's team tiles). Pure functions of an id, so a team or project
 * keeps its look on every device.
 */

/** Gradient pairs the generated tiles pick from: the app's lime, then the fleet's colours. */
const TILE_PALETTES: [string, string][] = [
  ["#d9f99d", "#86efac"],
  ["#c7d2fe", "#f0abfc"],
  ["#bae6fd", "#a5b4fc"],
  ["#fde68a", "#fca5a5"],
  ["#bbf7d0", "#99f6e4"],
  ["#fbcfe8", "#c4b5fd"],
  ["#fed7aa", "#fde68a"],
  ["#a7f3d0", "#bef264"],
];

/** A stable small number for a string, so a team or project keeps its colours. */
export function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function paletteFor(id: string): [string, string] {
  return TILE_PALETTES[seedOf(id) % TILE_PALETTES.length];
}

/** Up to two letters for a name: "Brand refresh" → "BR", "acme" → "AC". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/[\s_\-./]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1
      ? Array.from(words[0]).slice(0, 2).join("")
      : Array.from(words[0])[0] + Array.from(words[1])[0];
  return letters.toUpperCase();
}

/** A soft gradient for `id`, as a CSS background. */
export function tileGradient(id: string): string {
  const [a, b] = paletteFor(id);
  const angle = 120 + (seedOf(id) % 90);
  return `linear-gradient(${angle}deg, ${a} 0%, ${b} 100%)`;
}
