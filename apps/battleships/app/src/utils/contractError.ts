/**
 * Turn a contract error into something a person can read.
 *
 * The game and lobby WASM return their errors as a JSON object — e.g.
 * `{"data":"both players must place ships first","kind":"Invalid"}` — but the
 * node hands that back as the UTF-8 BYTES of that JSON, rendered into the
 * message as a literal array:
 *
 *     the method call returned an error: [123, 34, 100, 97, 116, 97, ...]
 *
 * So every guard the contract writes carefully ends up on screen as a wall of
 * numbers. Worse, the code that tries to react to a specific failure
 * (`message.includes('Finished')`) never matches, because by the time it looks
 * the text is not text any more — the match-over branch in the shot handler had
 * been dead for exactly this reason.
 *
 * Pure, so it is testable without a node.
 */

export interface ContractError {
  /** The contract's own message, e.g. "both players must place ships first". */
  data: string;
  /** The variant, e.g. "Invalid", "Forbidden", "Finished", "NotFound". */
  kind: string;
}

/** Pull the `[1, 2, 3]` byte array out of a message and decode it to text. */
function decodeByteArray(message: string): string | null {
  const match = message.match(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/);
  if (!match) return null;
  try {
    const nums = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(nums) || nums.length === 0) return null;
    if (!nums.every((n) => typeof n === 'number' && n >= 0 && n <= 255)) return null;
    return new TextDecoder().decode(Uint8Array.from(nums as number[]));
  } catch {
    return null;
  }
}

/**
 * Parse a contract error out of whatever the SDK threw.
 *
 * Handles the byte-array form, a plain JSON body, and a message that merely
 * contains one. Returns null when there is no contract error in there — a
 * network failure stays a network failure.
 */
export function parseContractError(error: unknown): ContractError | null {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!message) return null;

  const candidates = [decodeByteArray(message), message].filter(
    (c): c is string => typeof c === 'string' && c.length > 0,
  );

  for (const candidate of candidates) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
      if (!parsed || typeof parsed !== 'object') continue;
      const { data, kind } = parsed as Record<string, unknown>;
      // `kind` alone is enough: `{"kind":"Finished"}` carries no `data`.
      if (typeof kind !== 'string' || !kind) continue;
      return { data: typeof data === 'string' ? data : '', kind };
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return null;
}

/**
 * The sentence to show the user.
 *
 * Prefers the contract's own words — they are written for a player, not a
 * developer — and falls back to the variant, then to whatever was thrown.
 */
export function contractErrorMessage(error: unknown, fallback: string): string {
  const parsed = parseContractError(error);
  if (parsed) {
    if (parsed.data) return parsed.data;
    if (parsed.kind === 'Finished') return 'This match is already finished';
    return parsed.kind;
  }
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // Never show a raw byte array, even when it did not parse as an error body.
  if (/\[\s*\d+\s*,/.test(message)) return fallback;
  return message || fallback;
}

/** True when the contract refused because a fleet is still undeployed. */
export function isShipsNotPlacedError(error: unknown): boolean {
  const parsed = parseContractError(error);
  return !!parsed && parsed.data.toLowerCase().includes('place ships');
}

/** True when the match is over — the UI should refresh rather than complain. */
export function isMatchFinishedError(error: unknown): boolean {
  const parsed = parseContractError(error);
  return !!parsed && (parsed.kind === 'Finished' || parsed.data.toLowerCase().includes('finished'));
}
