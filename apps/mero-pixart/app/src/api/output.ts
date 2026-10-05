// ── Contract call results, normalised ───────────────────────────────────────
//
// `execute` hands back the contract's `output` verbatim, and that has had three
// shapes across merod releases: a UTF-8 byte array (older nodes, and the mocked
// e2e harness), a JSON string, or already-parsed JSON. Both transports — the
// node's JSON-RPC and the relay's intents — are normalised here so the pages
// never see the difference.

const CORE_PREFIX = "the method call returned an error: ";

/** The text a decimal byte list spells, or null when `list` is not one. */
function decodeByteList(list: string): string | null {
  const m = /^\[((?:\s*\d+\s*,)*\s*\d+\s*)\]$/.exec(list.trim());
  if (!m) return null;
  const bytes = m[1].split(",").map((n) => Number(n.trim()));
  if (!bytes.length || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return null;
  try {
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

/** The message is a JSON string, so it arrives wrapped in quotes; unwrap it. */
function unquote(text: string): string {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
  } catch {
    /* not JSON — use the raw text */
  }
  return text;
}

/**
 * A contract abort (`app::bail!`) comes back as
 *   `the method call returned an error: "that member hasn't …"`
 * on core rc.81 and later, and on older nodes as
 *   `the method call returned an error: [34, 116, 104, …]`
 * — the same message as a JSON-encoded UTF-8 byte array. Without this a user
 * is shown a wall of numbers instead of "that member hasn't opened this
 * document yet…".
 */
export function decodeContractError(msg: string): string {
  const at = msg.indexOf(CORE_PREFIX);
  if (at !== -1) {
    const rest = msg.slice(at + CORE_PREFIX.length).trim();
    if (!rest) return msg;
    return unquote(decodeByteList(rest) ?? rest).trim() || msg;
  }
  // No prefix: a byte list may still sit anywhere in the message.
  const m = /\[((?:\s*\d+\s*,)*\s*\d+\s*)\]/.exec(msg);
  if (!m) return msg;
  const text = decodeByteList(m[0]);
  if (text === null) return msg;
  return unquote(text).trim() || msg;
}

/** The contract's return value out of whatever `execute` answered with. */
export function decodeOutput<T>(out: unknown): T {
  if (out === null || out === undefined) return null as T;
  if (typeof out === "string") {
    try { return JSON.parse(out) as T; } catch { return out as T; }
  }
  if (Array.isArray(out)) {
    if (out.length === 0) return null as T;
    if (typeof out[0] !== "number") return out as T; // already JSON objects
    const text = new TextDecoder().decode(new Uint8Array(out as number[]));
    return JSON.parse(text) as T;
  }
  if (typeof out === "object") return out as T;
  return null as T;
}
