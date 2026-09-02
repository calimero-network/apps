/**
 * Turn an opaque RPC/contract error into a readable, specific message.
 *
 * The node reports contract failures in several unfriendly shapes:
 *   - a bare wrapper string: `"the method call returned an error: [123, 34, …]"`
 *     where the `[…]` is the ASCII byte array of a JSON error, OR
 *   - `RpcError { message, data, type }` where `data` is that byte array or an
 *     already-decoded `{ kind, data }` object.
 *
 * Contract errors (the types/ crate `Error` enum) serialize as `{ kind, data }`,
 * e.g. {"data":"delete: caller is not the owner","kind":"Forbidden"}.
 *
 * `describeError` digs through all of that and returns the most specific
 * human-readable string, e.g. "Forbidden: delete: caller is not the owner".
 */
export function describeError(err: unknown): string {
  if (err == null) return 'Unknown error';
  if (typeof err === 'string') return cleanString(err);

  const e = err as Record<string, unknown>;
  const parts: string[] = [];

  const top = typeof e.message === 'string' && e.message ? cleanString(e.message) : '';
  if (top) parts.push(top);

  const detail = extractDetail(e.data);
  if (detail && !parts.some((p) => p.includes(detail))) parts.push(detail);

  if (parts.length === 0 && typeof e.type === 'string') parts.push(e.type);

  return parts.join(' — ') || String(err);
}

/**
 * Decode a byte array of ASCII codes into text.
 * `[123, 34, …]` → `{"data":"…","kind":"Forbidden"}`.
 */
export function bytesToText(bytes: number[]): string {
  return bytes
    .filter((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    .map((b) => String.fromCharCode(b))
    .join('');
}

/** If `text` parses as a `{ kind, data }` contract error, format it nicely. */
function formatContractError(text: string): string {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return trimmed;
  try {
    return extractDetail(JSON.parse(trimmed)) ?? trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Replace any embedded ASCII byte-array (`[123, 34, …]`) in a string with its
 * decoded, formatted contract error — and drop the noisy wrapper prefix.
 */
function cleanString(s: string): string {
  const match = s.match(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/);
  if (match) {
    try {
      const bytes = JSON.parse(match[0]) as number[];
      const decoded = formatContractError(bytesToText(bytes));
      if (decoded) return decoded;
    } catch {
      /* fall through to the raw string */
    }
  }
  return s;
}

/** Recursively pull a readable string out of a contract error payload. */
function extractDetail(data: unknown): string | null {
  if (data == null) return null;
  if (typeof data === 'string') return cleanString(data);

  // A raw ASCII byte array (the node's FunctionCallError payload).
  if (Array.isArray(data) && data.every((x) => typeof x === 'number')) {
    return formatContractError(bytesToText(data as number[])) || null;
  }

  if (typeof data === 'object') {
    const d = data as Record<string, unknown>;
    // Contract Error serde shape: { kind: "Forbidden", data: "…" }
    const kind = typeof d.kind === 'string' ? d.kind : null;
    const inner = extractDetail(d.data ?? d.message ?? d.error);
    if (kind && inner) return `${kind}: ${inner}`;
    if (inner) return inner;
    if (kind) return kind;
    try {
      const json = JSON.stringify(data);
      return json && json !== '{}' ? json : null;
    } catch {
      return null;
    }
  }
  return String(data);
}
