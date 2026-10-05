import type { ExecuteTransport } from "@calimero-network/mero-js";

/**
 * Calling the calendar contract.
 *
 * `rpc` is `useMero().mero.rpc` — the one transport that is right for both
 * sessions: a node's JSON-RPC `execute`, or warrant-signed writes through the
 * relay for an account. The raw `POST {nodeUrl}/jsonrpc` with the stored JWT
 * this replaced could only ever reach a node; a delegated session has no node
 * URL and no node token, so every contract call failed before it was sent.
 */

/**
 * The contract's output, whatever the node wrapped it in: a JSON value, a JSON
 * string, or (older nodes) a `u8[]` byte array of the JSON text.
 */
export function parseOutput<T>(out: unknown): T {
  if (out === null || out === undefined) return null as T;
  if (typeof out === "string") {
    try {
      return JSON.parse(out) as T;
    } catch {
      return out as T;
    }
  }
  if (Array.isArray(out)) {
    if (out.length === 0) return [] as unknown as T;
    if (typeof out[0] !== "number") return out as T; // already JSON objects
    const text = new TextDecoder().decode(new Uint8Array(out as number[]));
    return JSON.parse(text) as T;
  }
  if (typeof out === "object") return out as T;
  return out as T;
}

/** Execute a contract method on a context and return its parsed output. */
export async function callContract<T>(
  rpc: ExecuteTransport,
  contextId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const raw = await rpc.execute<unknown>({ contextId, method, argsJson: args });
  return parseOutput<T>(raw);
}
