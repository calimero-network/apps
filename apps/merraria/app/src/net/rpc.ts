// Contract calls, over whichever mero-js transport the session rides.
//
// Node: mero-js's `RpcClient` POSTs `{node}/jsonrpc` with the camelCase
// `execute` envelope (`contextId`, `method`, `argsJson` as a raw object) and
// the bearer the token store holds. Account: the delegated client's `rpc`
// reads through the relay's query route and writes as `/intents` warrants.
// Both satisfy `ExecuteTransport`, so this module never sees the difference —
// and never opens a socket of its own: there is no `fetch` here on purpose.
//
// `params` is EXACTLY `contextId`/`method`/`argsJson`. Core's
// `ExecutionRequest` carries `deny_unknown_fields`, so a fourth key is a 400
// for the whole call (`executorPublicKey` was that key once; the node derives
// the executor from the credential). mero-js builds the envelope and the test
// beside this file pins what we hand it.

import { RpcError, type ExecuteTransport } from "@calimero-network/mero-js";

export type Exec = <T = unknown>(method: string, args: Record<string, unknown>) => Promise<T>;

/**
 * Decode a contract return value. mero-js hands back `result.output`, which
 * across node versions has been a parsed value, a JSON string, or a legacy
 * `u8[]` byte array — tolerate all three.
 */
export function decodeOutput(output: unknown): unknown {
  if (output == null) return null;
  if (Array.isArray(output) && output.every((v) => typeof v === "number")) {
    const text = new TextDecoder().decode(new Uint8Array(output as number[]));
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (typeof output === "string") {
    try {
      return JSON.parse(output);
    } catch {
      return output;
    }
  }
  return output;
}

/** The WASM reason out of a JSON-RPC error body (`error.data` wins). */
export function extractRpcError(body: Record<string, unknown>): string | null {
  const err = body?.error as Record<string, unknown> | undefined;
  if (!err) return null;
  if (typeof err.data === "string" && err.data) return err.data;
  if (err.data != null && typeof err.data === "object") return JSON.stringify(err.data);
  if (typeof err.message === "string" && err.message) return err.message;
  return JSON.stringify(err);
}

/**
 * The reason behind a failed call, as the player should read it: the WASM
 * error's `data` (the contract's own words, e.g. `{"type":"Uninitialized"}`
 * that boot() waits on), else the message. Non-RPC failures (the relay
 * refused a warrant, the node is down) keep their own message.
 */
export function describeExecError(err: unknown): string {
  if (err instanceof RpcError) {
    const fromData = extractRpcError({ error: { data: err.data, message: err.message } });
    return fromData ?? err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bind a transport to a context: the `exec(method, args)` the game engine
 * (SyncEngine) is written against. Errors read `rpc <method>: <reason>`, the
 * shape the fatal screen and the "world not ready yet" retry match on.
 */
export function bindExec(rpc: ExecuteTransport, contextId: string): Exec {
  return async <T = unknown>(method: string, args: Record<string, unknown>): Promise<T> => {
    let output: unknown;
    try {
      output = await rpc.execute<unknown>({ contextId, method, argsJson: args });
    } catch (err) {
      throw new Error(`rpc ${method}: ${describeExecError(err)}`);
    }
    return decodeOutput(output) as T;
  };
}
