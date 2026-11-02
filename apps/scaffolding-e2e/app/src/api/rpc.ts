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
//     `envelope.error` instead of thrown, because the sections show it;
//   • a listing (`Listing<…>`: `cursor`/`limit` in, `{ items, next }` out) is
//     read page by page, following `next`, and handed back in v1's shape: the
//     items of every page (arrays concatenated, maps merged keeping a key's
//     first value). A caller that passes `cursor` or `limit` gets one raw page.

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

/** Whether the method answers one page of a listing. */
export function isListing(spec: MethodSpec | undefined): boolean {
  return !!spec?.returns?.startsWith("Listing<");
}

/** The most pages one listing read follows (1,000 entries each). */
export const MAX_PAGES = 100;

interface ListingPage {
  items: unknown;
  next: string | null;
}

/** Page `b` appended to the items read so far: arrays concatenated, maps keep a key's first value. */
export function mergeItems(a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === "object" && typeof b === "object") return { ...(b as object), ...(a as object) };
  return b;
}

/** Every page of a listing, from `read(cursor)`, as one value in v1's shape. */
export async function readAllPages(read: (cursor: string | undefined) => Promise<unknown>): Promise<unknown> {
  let items: unknown;
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = (await read(cursor)) as ListingPage;
    items = mergeItems(items, page.items);
    if (!page.next) return items;
    cursor = page.next;
  }
  throw new Error(`more than ${MAX_PAGES} pages; read it with cursor/limit`);
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
  const send = async (a: Record<string, unknown>) =>
    (spec?.view ? await conn.client.view(conn.appId, name, a) : await conn.client.call(conn.appId, name, a)).result;
  try {
    if (isListing(spec) && args.cursor === undefined && args.limit === undefined) {
      const items = await readAllPages((cursor) => send(cursor === undefined ? args : { ...args, cursor }));
      return { result: { output: items as T } };
    }
    return { result: { output: fromWire(spec, await send(args)) as T } };
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
