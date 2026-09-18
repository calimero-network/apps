/**
 * Presentation helpers, kept out of the components so they can be unit-tested
 * without a DOM.
 */

/**
 * Shorten a 64-hex id for display without making two different ids look alike.
 *
 * Keeps both ends: a prefix alone collides constantly in a demo where every id
 * is a hash, and the whole point of showing an id at all is being able to tell
 * "this is the account I minted" from "this is the node's account".
 */
export function short(hex: string, keep = 8): string {
  if (hex.length <= keep * 2 + 1) return hex;
  return `${hex.slice(0, keep)}…${hex.slice(-keep)}`;
}

/** Pretty-print whatever a node sent back, including the things that are not JSON. */
export function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    // Cyclic, or a BigInt, which `JSON.stringify` throws on rather than
    // encoding — and a nonce is a BigInt, so this is reachable rather than
    // defensive.
    return String(value);
  }
}

/**
 * Parse the JSON a text box holds, naming the field when it will not parse.
 *
 * Returns the error rather than throwing so a component can show it next to the
 * box instead of losing the rest of the render to an exception.
 */
export function parseJson(
  text: string,
  field: string,
): { value: unknown; error: null } | { value: null; error: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { value: {}, error: null };
  try {
    return { value: JSON.parse(trimmed) as unknown, error: null };
  } catch (err) {
    return {
      value: null,
      error: `${field} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * The message to show for a thrown value.
 *
 * mero-js throws `IntentRefusedError` with a `reason` that says which of three
 * unrelated preconditions failed, and that reason is the useful part — an
 * `Error.message` alone reads "relay refused the intent (HTTP 403)", which
 * sends a reader to the wrong place two times out of three.
 */
export function errorText(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { reason?: unknown; message?: unknown; body?: unknown };
    if (typeof e.reason === 'string' && e.reason) {
      return typeof e.message === 'string' ? e.message : e.reason;
    }
    if (typeof e.message === 'string' && e.message) {
      // `HTTPError` carries the response body, which is where a node puts the
      // detail that explains the status.
      return typeof e.body === 'string' && e.body ? `${e.message}: ${e.body}` : e.message;
    }
  }
  return String(err);
}

/**
 * A URL's host, for somewhere too narrow to show the whole thing.
 *
 * **Never throws**, which is the entire reason it exists rather than an inline
 * `new URL(x).host`. `URL` rejects anything without a scheme — `relay.example`
 * throws where `https://relay.example` does not, and so does a lone space — and
 * these values come from `localStorage`, typed by hand into a field that has
 * never validated them. An inline construction therefore threw during render,
 * which in React takes the whole page rather than the one label: a stored node
 * URL of `relay.example` turned the app into a blank screen, with the failure
 * surviving every reload because the bad value is what is persisted.
 *
 * Returning the input unparsed is right for a display helper. It is a label; a
 * value too malformed to parse is exactly the thing the reader needs to see,
 * and the code that actually *uses* the URL fails with its own error.
 */
export function hostOf(url: string): string {
  try {
    // An empty host is not a throw and still has to fall back: a typo'd scheme
    // like `htp:/relay.example` parses as an opaque path, so `.host` is `''`
    // and the label would render as nothing at all — which reads as "no relay"
    // for a tab that has one, and is the more misleading of the two failures.
    return new URL(url).host || url;
  } catch {
    return url;
  }
}
