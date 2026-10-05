// ── JSON-RPC to the contract ─────────────────────────────────────────────────
//
// The node's `execute` endpoint, through mero-js's `rpc.execute` (the shared
// client in `lib/mero.ts`), with the same envelope handling every mero app
// uses (mero-pixart's `api/output.ts` is the sibling of this file).
//
// Two details that are easy to get wrong and expensive to debug:
//
//   • `output` arrives either as a UTF-8 BYTE ARRAY (older nodes) or as already
//     parsed JSON (newer ones). Both shapes have to be accepted, or the app reads
//     `[123, 34, …]` where it expected an object.
//   • a contract `app::bail!` comes back as
//       the method call returned an error: [34, 116, …]
//     — the message itself as a byte array. Decoding it is the difference between
//     showing "that key is frozen" and showing a wall of numbers.

import { RpcError } from "@calimero-network/mero-js";
import { getContextId, getMeroClient } from "../lib/mero";

/**
 * The node's JSON-RPC envelope, with `output` parsed.
 *
 * The scaffold's sections display this verbatim — showing exactly what the node
 * returned is the point of the app — so the envelope is preserved rather than
 * unwrapped, and a contract error arrives as `error` instead of as an exception.
 * `ResultBox` colours a response red by looking for that key.
 */
export interface RpcEnvelope<T = unknown> {
  result?: { output?: T; logs?: string[] };
  error?: unknown;
  data?: unknown;
}

/** Thrown for any RPC failure, with the contract's own message when it had one. */
export class RpcCallError extends Error {
  constructor(message: string, readonly method: string) {
    super(message);
    this.name = "RpcCallError";
  }
}

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

/** An `app::bail!` message is a JSON string; take the string out of its quotes. */
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
 * Decode a contract error message: the text core rc.81 renders behind the
 * prefix, or the byte list older nodes put there.
 *
 * Exported for tests: this is the one piece of the envelope with no observable
 * effect other than what the user reads.
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

/** Pull a readable message out of whatever the node put in `error`. */
function errorMessage(error: unknown): string {
  if (typeof error === "string") return decodeContractError(error);
  if (error && typeof error === "object") {
    const e = error as { data?: unknown; message?: unknown; type?: unknown };
    if (typeof e.data === "string" && e.data) return decodeContractError(e.data);
    if (typeof e.message === "string" && e.message) return decodeContractError(e.message);
    if (typeof e.type === "string" && e.type) return e.type;
    return JSON.stringify(error);
  }
  return "RPC error";
}

/** Normalise `result.output` into a value the app can use. */
export function parseRpcOutput<T>(output: unknown): T {
  if (output === null || output === undefined) return null as T;
  if (typeof output === "string") {
    try {
      return JSON.parse(output) as T;
    } catch {
      return output as T;
    }
  }
  if (Array.isArray(output)) {
    // An EMPTY array stays an empty array. It used to become `null`, and that is
    // wrong for every list-returning method in this contract — `list_files`,
    // `search_files`, `acl_members_of`, `sorted_keys`, `authored_vec_entries`
    // and the rest all legitimately return `[]`.
    //
    // The symptom was almost unreadable: `typeof null === "object"`, so the
    // TestRunner's `isArray()` reported "expected array, got object" for a
    // method that had returned a perfectly good `[]`. And the two file panels do
    //
    //     const files = res?.result?.output;
    //     if (files !== undefined) setLiveFiles(files);
    //
    // so on an empty store they were assigning `null` into state typed
    // `FileRecord[]`.
    //
    // `[]` is ALSO what an empty byte payload arrives as, and the two are
    // genuinely indistinguishable from the value alone — only the ABI knows, and
    // this function is generic. Preserving the array is the better default: a
    // list is the common case here, and a byte-payload consumer decoding `[]`
    // gets `""`, which is a truer answer for "no bytes" than `null` is for
    // "no elements".
    if (output.length === 0) return output as T;
    // A byte array is all numbers; anything else is already parsed JSON.
    if (typeof output[0] !== "number") return output as T;
    const text = new TextDecoder().decode(new Uint8Array(output as number[]));
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }
  if (typeof output === "object") return output as T;
  return output as T;
}

/**
 * Call a contract method in the selected context and return the raw envelope.
 *
 * The caller's identity is NOT passed: the node takes it from the bearer token,
 * which is the only version it will trust anyway. (The previous SDK sent an
 * `executorPublicKey` alongside; it was advisory at best.)
 *
 * A contract-level failure comes back as `envelope.error` — it does NOT throw,
 * because the UI shows it. Only a transport failure or an unusable local state
 * throws.
 */
export async function rpcRaw<T = unknown>(
  method: string,
  argsJson: Record<string, unknown> = {},
  contextId = getContextId() ?? "",
): Promise<RpcEnvelope<T>> {
  const client = getMeroClient();
  if (!client) throw new RpcCallError("No node selected — connect to a node first.", method);
  if (!contextId) {
    throw new RpcCallError(
      "No context selected — create or pick one in the Setup Wizard first.",
      method,
    );
  }

  // mero-js's `rpc.execute` POSTs the same `execute` envelope to `/jsonrpc`
  // (bearer token, URL join that keeps a NODE_PATH_PREFIX, token refresh on
  // 401) and unwraps it: `result.output` on success, a thrown `RpcError` for
  // the node's `error`. The scaffold wants the envelope back — its sections
  // show exactly what the node said and `ResultBox` colours by the `error`
  // key — so the two outcomes are folded back into one here.
  let output: unknown;
  try {
    output = await client.rpc.execute<unknown>({ contextId, method, argsJson });
  } catch (err) {
    if (err instanceof RpcError) {
      // The node's `error` object, as `jsonRpcCall` normalised it. `data` is
      // where a contract `app::bail!` lives (as a byte array in prose);
      // `type` is e.g. `FunctionCallError`.
      return {
        error: {
          code: err.code,
          message: err.message,
          ...(err.type !== undefined ? { type: err.type } : {}),
          ...(err.data !== undefined ? { data: err.data } : {}),
        },
      };
    }
    const status = (err as { status?: unknown })?.status;
    if (typeof status === "number") {
      throw new RpcCallError(`Request failed (${status})`, method);
    }
    throw new RpcCallError(err instanceof Error ? err.message : String(err), method);
  }
  return { result: { output: parseRpcOutput<T>(output) } };
}

/**
 * Call a contract method and return its value, throwing on any failure.
 *
 * For the app's own logic (as opposed to the sections, which display the
 * envelope): reading a value you intend to act on.
 */
export async function rpcCall<T>(
  method: string,
  argsJson: Record<string, unknown> = {},
  contextId?: string,
): Promise<T> {
  const envelope = await rpcRaw<T>(method, argsJson, contextId);
  if (envelope.error) throw new RpcCallError(errorMessage(envelope.error), method);
  return (envelope.result?.output ?? (envelope.data as T) ?? null) as T;
}
