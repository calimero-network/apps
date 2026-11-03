// ── Calling the contract ─────────────────────────────────────────────────────
//
// Every section calls the contract by its v1 method name with v1's snake_case
// arguments (`rpcRaw("get_result", { key })`) and reads back the envelope it
// displays (`{ result: { output } }` or `{ error }`). This file is the one
// place that maps that onto the 1.0 client:
//
//   • the method name and argument names become camelCase (the component ABI's);
//   • a view goes through `client.view`, anything else through `client.call`
//     (the ABI says which; a call is logged, a view is not);
//   • 64-bit integers travel as decimal strings: a number argument is sent as
//     one, and a `u64`/`i64` result comes back as a number again;
//   • a typed contract error (`AppError`: `appCode` + `fields`) is folded into
//     `envelope.error` instead of thrown, because the sections show it.

import { describeError } from "@calimero-apps/connect";

import { getConnection } from "../lib/calimero";
import { METHODS, type MethodSpec } from "./abi";

/**
 * What a section displays: the value, or the error. `ResultBox` colours a
 * response red by looking for the `error` key.
 */
export interface RpcEnvelope<T = unknown> {
  result?: { output?: T };
  error?: unknown;
}

/** Thrown for an unusable local state (not signed in, no instance open). */
export class RpcCallError extends Error {
  constructor(
    message: string,
    readonly method: string,
  ) {
    super(message);
    this.name = "RpcCallError";
  }
}

/** `get_result` → `getResult`; a name already in camelCase stays. */
export function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** `uploadedAt` → `uploaded_at`. */
export function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

const INT64 = /^(option<)?(u64|i64)>?$/;

/** The arguments as the ABI names and types them. */
export function toWireArgs(spec: MethodSpec | undefined, args: Record<string, unknown>): Record<string, unknown> {
  const types = new Map(spec?.params ?? []);
  return Object.fromEntries(
    Object.entries(args).map(([k, v]) => {
      const name = camel(k);
      const type = types.get(name) ?? "";
      const wire = INT64.test(type) && typeof v === "number" ? String(Math.trunc(v)) : v;
      return [name, wire];
    }),
  );
}

/** A `u64`/`i64` result (a decimal string on the wire) as a number. */
export function fromWire(spec: MethodSpec | undefined, value: unknown): unknown {
  if (spec?.returns && INT64.test(spec.returns) && typeof value === "string") return Number(value);
  return value;
}

/** The error as the sections show it: the contract's code and fields, and a readable line. */
function errorEnvelope(e: unknown): RpcEnvelope["error"] {
  const err = e as { appCode?: string; fields?: unknown; code?: string; status?: number };
  return {
    ...(err.appCode ? { code: err.appCode } : err.code ? { code: err.code } : {}),
    ...(err.fields !== undefined ? { fields: err.fields } : {}),
    ...(typeof err.status === "number" ? { status: err.status } : {}),
    message: describeError(e),
  };
}

/**
 * Call a contract method on the open instance and return the envelope. A
 * contract failure comes back as `envelope.error`; only a missing session or
 * instance throws.
 */
export async function rpcRaw<T = unknown>(
  method: string,
  argsJson: Record<string, unknown> = {},
): Promise<RpcEnvelope<T>> {
  const conn = getConnection();
  if (!conn) {
    throw new RpcCallError("No app instance open — sign in and pick one in the Setup Wizard first.", method);
  }
  const name = camel(method);
  const spec = METHODS[name];
  const args = toWireArgs(spec, argsJson);
  try {
    const answer = spec?.view
      ? await conn.client.view(conn.appId, name, args)
      : await conn.client.call(conn.appId, name, args);
    return { result: { output: fromWire(spec, answer.result) as T } };
  } catch (e) {
    return { error: errorEnvelope(e) };
  } finally {
    conn.after();
  }
}

/** Call a method and return its value, throwing on any failure. */
export async function rpcCall<T>(method: string, argsJson: Record<string, unknown> = {}): Promise<T> {
  const envelope = await rpcRaw<T>(method, argsJson);
  if (envelope.error) {
    const e = envelope.error as { message?: string };
    throw new RpcCallError(e.message ?? JSON.stringify(envelope.error), method);
  }
  return (envelope.result?.output ?? null) as T;
}
