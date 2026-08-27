/**
 * The server's limit on a group's display name, and how to check it here.
 *
 * `groupName` is stored in a MetadataRecord capped at 64 BYTES. Over that, the
 * name is dropped — and the request still returns 200, so nothing surfaces. A
 * DM subgroup named after both participants (`DM_CONTEXT_` + two 64-hex
 * accounts = 140 bytes) was discarded on every write for exactly this reason,
 * and the failure showed up much later as "the other person never sees the DM".
 *
 * Measured against a live node: a 60-character name is stored, a 70-character
 * one is not.
 *
 * Checking here turns silent data loss into a message someone can act on.
 */
export const MAX_GROUP_NAME_BYTES = 64;

/**
 * The name's length as the server measures it.
 *
 * Bytes, not characters: "café" is 4 characters and 5 bytes, an emoji is 1 and
 * 4. A `name.length` check passes names the server then throws away.
 */
export function groupNameByteLength(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * Why this name cannot be used, or `null` if it can.
 *
 * Measures the TRIMMED name because that is what callers send.
 */
export function groupNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name cannot be empty";

  const bytes = groupNameByteLength(trimmed);
  if (bytes > MAX_GROUP_NAME_BYTES) {
    return `Name is too long (${bytes} of ${MAX_GROUP_NAME_BYTES} bytes). Emoji and accents count for more than one.`;
  }

  return null;
}
