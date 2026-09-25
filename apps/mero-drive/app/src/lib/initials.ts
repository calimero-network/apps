/** Two-letter monogram: the first letters of the first two words, else the first two letters. */
export function initials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[1][0] : label.trim().slice(0, 2);
  return letters.toUpperCase();
}
