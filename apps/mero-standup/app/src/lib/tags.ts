/**
 * "Infra, release process" -> ["infra", "release-process"]: the same
 * normalization the contract applies, so the preview chips under the field
 * show exactly what will be stored.
 */
export function parseTags(input: string): string[] {
  const out = input
    .split(",")
    .map((t) => t.trim().split(/\s+/).filter(Boolean).join("-").toLowerCase())
    .filter(Boolean);
  return [...new Set(out)].sort();
}
