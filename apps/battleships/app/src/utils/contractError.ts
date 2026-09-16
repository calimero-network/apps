/**
 * Turn a contract error into something a person can read.
 *
 * The game and lobby WASM return their errors as a JSON object — e.g.
 * `{"data":"both players must place ships first","kind":"Invalid"}` — but the
 * node hands that back as the UTF-8 BYTES of that JSON, wrapped in a JSON-RPC
 * envelope:
 *
 *     { "jsonrpc": "2.0", "id": 1, "error": {
 *         "type": "FunctionCallError",
 *         "data": "the method call returned an error: [123, 34, 100, ...]" } }
 *
 * So every guard the contract writes carefully ends up on screen as a wall of
 * numbers. Worse, code that reacts to a specific failure
 * (`message.includes('Finished')`) never matches, because by the time it looks
 * the text is not text any more.
 *
 * This module unwraps that, structurally:
 *
 *   1. walk the thrown value for payload candidates — it may be an `Error`, a
 *      string, the envelope object itself, or an axios-style `{ response }`
 *   2. inside a candidate string, find a BALANCED `{...}` or a byte array and
 *      decode it
 *   3. recurse, because a byte array decodes to JSON which may itself be an
 *      envelope
 *
 * Pure, so it is testable without a node.
 */

export interface ContractError {
  /** The contract's own message, e.g. "both players must place ships first". */
  data: string;
  /** The variant, e.g. "Invalid", "Forbidden", "Finished", "NotFound". */
  kind: string;
}

/**
 * Depth cap — purely a termination guard, not a model of the shape.
 *
 * One hop is cheap and the nesting is deeper than it looks: an axios error
 * wrapping the envelope, whose `error.data` is prose, holding a byte array,
 * which decodes to JSON that is parsed and searched again, is already eight
 * levels. Set it by what terminates, not by what is expected — too tight and a
 * real error silently reads as "no contract error".
 */
const MAX_DEPTH = 16;
/** Refuse to decode an absurd array before allocating for it. */
const MAX_BYTES = 256 * 1024;

/**
 * Decode `[123, 34, ...]` to the text those bytes spell.
 *
 * ⚠️ VALIDATES EVERY ELEMENT. `Number.isInteger` and the 0-255 range together
 * are what stop a coordinate list, a version triple, or any other bracketed
 * run of digits in an unrelated message from being "decoded" into mojibake and
 * then presented to the user as if it were the contract talking.
 */
function decodeBytes(values: readonly unknown[]): string | null {
  if (values.length === 0 || values.length > MAX_BYTES) return null;
  const bytes = new Uint8Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 255) return null;
    bytes[i] = v;
  }
  try {
    // `fatal` so invalid UTF-8 throws instead of yielding replacement
    // characters — a number list that is not text must fail, not half-decode.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Every balanced `{...}` and `[...]` run in a string, outermost first.
 *
 * Scanning for balance is the point. `indexOf('{')` with `lastIndexOf('}')`
 * spans everything between the first and last brace, which breaks the moment a
 * message carries two objects or any trailing punctuation; and a regex for
 * `\[[\d, ]+\]` picks whichever bracketed run happens to come first, which in
 * "shot at [3, 4]: [123, 34, ...]" is the wrong one.
 */
function balancedRuns(text: string): string[] {
  const runs: string[] = [];
  const openers: Record<string, string> = { '{': '}', '[': ']' };
  for (let i = 0; i < text.length; i += 1) {
    const close = openers[text[i]!];
    if (!close) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j]!;
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{' || c === '[') depth += 1;
      else if (c === '}' || c === ']') {
        depth -= 1;
        if (depth === 0) {
          runs.push(text.slice(i, j + 1));
          i = j; // resume after this run; nested runs are reached by recursion
          break;
        }
      }
    }
  }
  return runs;
}

/** A parsed object that actually is a contract error. */
function asContractError(value: unknown): ContractError | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { data, kind } = value as Record<string, unknown>;
  // `kind` alone is enough: `{"kind":"Finished"}` carries no `data`.
  if (typeof kind !== 'string' || !kind) return null;
  return { data: typeof data === 'string' ? data : '', kind };
}

/**
 * Walk any thrown value for a contract error.
 *
 * Takes the envelope OBJECT as readily as a string, so a caller that has the
 * parsed JSON-RPC response does not have to stringify it first.
 */
function search(value: unknown, depth: number): ContractError | null {
  if (depth > MAX_DEPTH || value == null) return null;

  if (typeof value === 'string') {
    // The whole string may be the body.
    try {
      const direct = JSON.parse(value) as unknown;
      const hit = search(direct, depth + 1);
      if (hit) return hit;
    } catch {
      // Not JSON on its own — it is prose with a body embedded in it.
    }
    for (const run of balancedRuns(value)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(run);
      } catch {
        continue;
      }
      const hit = search(parsed, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  if (Array.isArray(value)) {
    // A byte array decodes to text, which is itself JSON to be searched.
    const text = decodeBytes(value);
    return text ? search(text, depth + 1) : null;
  }

  if (value instanceof Error) return search(value.message, depth + 1);

  if (typeof value === 'object') {
    const direct = asContractError(value);
    if (direct) return direct;
    // The shapes an error arrives in: the JSON-RPC envelope, an axios
    // response, a wrapped cause. Named rather than walked generically, so an
    // unrelated field cannot be mistaken for the payload.
    const o = value as Record<string, unknown>;
    for (const key of ['error', 'data', 'response', 'body', 'message', 'cause']) {
      const hit = search(o[key], depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Parse a contract error out of whatever the SDK threw. Null when there is none. */
export function parseContractError(error: unknown): ContractError | null {
  return search(error, 0);
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
  return (
    !!parsed && (parsed.kind === 'Finished' || parsed.data.toLowerCase().includes('finished'))
  );
}
