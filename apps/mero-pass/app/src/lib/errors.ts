/**
 * Turn whatever a node call threw into a sentence a person can act on.
 *
 * The node answers a failed `execute` with `{ type, data }`, and mero-js puts
 * the TYPE in `Error.message`. So every contract refusal reached the screen as
 * the bare word "FunctionCallError", with the reason sitting unread in
 * `data`:
 *
 *     { type: "FunctionCallError",
 *       data: "the method call returned an error: [34, 111, 110, ...]" }
 *
 * The bytes are the contract's own `app::bail!` message, JSON-encoded. This
 * reads `data`, decodes the bytes, and rewrites the few messages that name a
 * node condition rather than a mistake by the user.
 */

/** Bytes → text, or null when the list is not UTF-8 bytes. */
function decodeBytes(list: string): string | null {
  let values: unknown;
  try {
    values = JSON.parse(list);
  } catch {
    return null;
  }
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!values.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
    return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Uint8Array.from(values as number[]),
    );
  } catch {
    return null;
  }
}

/** The contract's message inside a decoded body: a JSON string, or text. */
function unwrapBody(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string') return parsed;
    if (parsed && typeof parsed === 'object') {
      const o = parsed as Record<string, unknown>;
      for (const key of ['message', 'data', 'error']) {
        if (typeof o[key] === 'string') return o[key] as string;
      }
    }
  } catch {
    // Not JSON: the bytes were the message itself.
  }
  return body;
}

/** The raw reason the node gave, before any rewording. */
export function rawReason(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string') return e;
  const o = e as { data?: unknown; type?: unknown; message?: unknown };
  const data = o.data;
  if (typeof data === 'string' && data) {
    const bytes = /\[[\d,\s]+\]/.exec(data);
    const decoded = bytes ? decodeBytes(bytes[0]) : null;
    return decoded ? unwrapBody(decoded) : data;
  }
  if (data && typeof data === 'object') {
    const inner = (data as { type?: unknown }).type;
    if (typeof inner === 'string') return inner;
  }
  if (typeof o.message === 'string' && o.message) return o.message;
  if (typeof o.type === 'string') return o.type;
  return String(e);
}

/**
 * Node conditions that clear on their own. Reworded, and marked so callers
 * retry instead of showing a dead end.
 */
const TRANSIENT: Array<[RegExp, string]> = [
  [
    /not a member of this context/i,
    'This node has not finished joining the vault yet.',
  ],
  [
    /awaiting state sync|Uninitialized/i,
    'This node is still downloading the vault from its peers.',
  ],
  [
    /group key not yet delivered|GroupKeyPending/i,
    'This node is still waiting for the team key from a peer.',
  ],
  [/No owned identity/i, 'This node has no identity in the vault yet.'],
];

const REWORDED: Array<[RegExp, string]> = [
  [/HTTP 403|Forbidden/i, 'This session is not allowed to do that.'],
  [/Failed to fetch|NetworkError/i, 'Cannot reach the node.'],
];

export function isTransient(e: unknown): boolean {
  const reason = rawReason(e);
  return TRANSIENT.some(([p]) => p.test(reason));
}

/** The sentence to show. */
export function describeError(e: unknown): string {
  const reason = rawReason(e);
  for (const [pattern, text] of [...TRANSIENT, ...REWORDED]) {
    if (pattern.test(reason)) return text;
  }
  return reason || 'Something went wrong.';
}
