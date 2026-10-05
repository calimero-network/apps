// ── Contract call results, normalised ───────────────────────────────────────
//
// `execute` hands back the contract's `output` verbatim, and that has had three
// shapes across merod releases: a UTF-8 byte array (older nodes, and the mocked
// e2e harness), a JSON string, or already-parsed JSON. Both transports — the
// node's JSON-RPC and the relay's intents — are normalised here so the pages
// never see the difference.

/**
 * A contract abort (`app::bail!`) comes back as
 *   `the method call returned an error: [34, 116, 104, …]`
 * — the message as a JSON-encoded UTF-8 byte array. Without this a user is
 * shown a wall of numbers instead of "that member hasn't opened this document
 * yet…".
 */
export function decodeContractError(msg: string): string {
  const m = /\[((?:\s*\d+\s*,)*\s*\d+\s*)\]/.exec(msg);
  if (!m) return msg;
  const bytes = m[1].split(",").map((n) => Number(n.trim()));
  if (!bytes.length || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return msg;
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    // The message is a JSON string, so it arrives wrapped in quotes (byte 34).
    let decoded = text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") decoded = parsed;
    } catch {
      /* not JSON — use the raw decode */
    }
    return decoded.trim() || msg;
  } catch {
    return msg;
  }
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
