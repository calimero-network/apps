/**
 * Running one row: call it, classify what happened, compare with what the row
 * expects.
 *
 * Classification is by what mero-js reports: an `AppError`'s app code, a
 * `TrapError`, or a `CalimeroError`'s API code (the node's refusal, by name).
 * Nothing else is forgiven: a wrong value read back, a timeout or an error with
 * no code fails, whatever the row expects.
 */
import type { Outcome, Row, Who } from "./types";

/** Thrown by a row whose call resolved but whose result was wrong. */
export class Mismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mismatch";
  }
}

/** Thrown by a row that cannot run because an earlier row it needs failed. */
export class Blocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Blocked";
  }
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Mismatch(message);
}

/** A precondition: the value an earlier row produced, or this row is blocked. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || value === "") {
    throw new Blocked(`needs ${what}, which an earlier row did not produce`);
  }
  return value;
}

export const OK = "ok";
/** An app's own refusal, by its `#[app::error]` code. */
export const appError = (code: string): Outcome => `APP_ERROR:${code}`;

/** What `e` is, as a row compares it. */
export function classify(e: unknown): { actual: Outcome; error: string } {
  const err = e as {
    name?: string;
    message?: string;
    status?: number;
    code?: string;
    appCode?: string;
    fields?: unknown;
    kind?: string;
  };
  const name = err?.name ?? "Error";
  if (name === "Mismatch") return { actual: "mismatch", error: String(err.message) };
  if (name === "Blocked") return { actual: "blocked", error: String(err.message) };
  const parts = [`${name}: ${err?.message ?? String(e)}`];
  if (err?.status !== undefined) parts.push(`status ${err.status}`);
  if (err?.code) parts.push(`code ${err.code}`);
  if (err?.appCode) parts.push(`appCode ${err.appCode} ${short(err.fields, 200)}`);
  if (err?.kind) parts.push(`kind ${err.kind}`);
  const error = parts.join(" | ");
  if (err?.code === "APP_ERROR" && err.appCode) return { actual: appError(err.appCode), error };
  if (err?.code === "TRAP" || name === "TrapError") return { actual: "TRAP", error };
  if (typeof err?.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(err.code)) return { actual: err.code, error };
  return { actual: "error", error };
}

export function short(v: unknown, max = 160): string {
  let s: string | undefined;
  try {
    s =
      typeof v === "string"
        ? v
        : JSON.stringify(v, (_k, x: unknown) =>
            typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? `<${x.length} bytes>` : x,
          );
  } catch {
    s = String(v);
  }
  if (s === undefined) s = "undefined";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface Recorder {
  record(row: Row): void;
}

/**
 * Run a row. Resolves with the call's value when it succeeded (so later rows
 * can use it) and `undefined` otherwise; never throws, so one failure does not
 * stop the matrix — the rows that needed its value report themselves blocked.
 */
export async function check<T>(
  rec: Recorder,
  who: Who,
  area: string,
  name: string,
  expected: Outcome,
  fn: () => Promise<T>,
  show?: (value: T) => unknown,
): Promise<T | undefined> {
  const t0 = performance.now();
  let actual: Outcome = OK;
  let error: string | undefined;
  let detail: string | undefined;
  let value: T | undefined;
  try {
    value = await fn();
    if (show) detail = short(show(value));
  } catch (e) {
    ({ actual, error } = classify(e));
  }
  rec.record({
    name: `${area} / ${name}`,
    area,
    who,
    expected,
    actual,
    pass: actual === expected,
    ...(error !== undefined ? { error } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ms: Math.round(performance.now() - t0),
  });
  return actual === OK ? value : undefined;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll `fn` until `ok(value)` or `timeoutMs`: for what lands a moment after the
 * call that caused it (a membership change reaching every node, an upgrade run
 * finishing). The last error or value is what fails.
 */
export async function eventually<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  let lastErr: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (ok(v)) return v;
      last = v;
      lastErr = undefined;
    } catch (e) {
      lastErr = e;
    }
    if (Date.now() > deadline) {
      if (lastErr) throw lastErr;
      throw new Mismatch(`${what}: still ${short(last)} after ${timeoutMs} ms`);
    }
    await sleep(250);
  }
}


/**
 * Poll `fn` until it is refused, then throw that refusal for the row to
 * classify: for an access change that reaches every node a moment after it is
 * made. Still allowed after `timeoutMs` is a `Mismatch`.
 */
export async function untilRefused(fn: () => Promise<unknown>, what: string, timeoutMs = 20_000): Promise<never> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await fn();
    if (Date.now() > deadline) throw new Mismatch(`${what}: still allowed after ${timeoutMs} ms`);
    await sleep(250);
  }
}
