/**
 * Running one row: call it, classify what happened, compare with what the row
 * expects in this mode.
 *
 * Classification is by error NAME for the two refusals mero-react names, and
 * nothing else is forgiven: a bare 403, a refused intent, a timeout and a wrong
 * value read back all fail, whatever the mode.
 */
import type { Expected, Mode, Outcome, Row } from './types';

/** Thrown by a row whose call resolved but whose result was wrong. */
export class Mismatch extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Mismatch';
  }
}

/** Thrown by a row that cannot run because an earlier row it needs failed. */
export class Blocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Blocked';
  }
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Mismatch(message);
}

/** A precondition: the value an earlier row produced, or this row is blocked. */
export function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined || value === '') throw new Blocked(`needs ${what}, which an earlier row did not produce`);
  return value;
}

export interface Expectation {
  readonly node: Expected;
  readonly account: Expected;
}

export const OK: Expectation = { node: 'ok', account: 'ok' };
/** A call with no account form: mero-react refuses it by name. */
export const NODE_ONLY: Expectation = { node: 'ok', account: 'NotForAccountError' };

function classify(e: unknown): { actual: Outcome; error: string } {
  const err = e as { name?: string; message?: string; status?: number; body?: unknown; type?: string; data?: unknown; step?: string };
  const name = err?.name ?? 'Error';
  if (name === 'NotForAccountError' || name === 'NoRelayError') return { actual: name, error: `${name}: ${err.message}` };
  if (name === 'Mismatch') return { actual: 'mismatch', error: String(err.message) };
  if (name === 'Blocked') return { actual: 'blocked', error: String(err.message) };
  const parts = [`${name}: ${err?.message ?? String(e)}`];
  if (err?.status !== undefined) parts.push(`status ${err.status}`);
  if (err?.step !== undefined) parts.push(`step ${err.step}`);
  if (err?.type !== undefined) parts.push(`type ${err.type}`);
  if (err?.data !== undefined) parts.push(`data ${short(err.data, 300)}`);
  if (err?.body !== undefined) parts.push(`body ${short(err.body, 300)}`);
  return { actual: 'error', error: parts.join(' | ') };
}

export function short(v: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));
  } catch {
    s = String(v);
  }
  if (s === undefined) s = 'undefined';
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export interface RowContext {
  readonly run: Mode;
  readonly mode: Mode;
  readonly session: 'primary' | 'second';
  readonly record: (row: Row) => void;
}

/**
 * Run a row. Resolves with the call's value when it succeeded (so later rows
 * can use it) and `undefined` otherwise; never throws, so one failure does not
 * stop the matrix — the rows that needed its value report themselves blocked.
 */
export async function check<T>(
  rc: RowContext,
  area: string,
  name: string,
  expect: Expectation,
  fn: () => Promise<T>,
  show?: (value: T) => unknown,
): Promise<T | undefined> {
  const expected = expect[rc.mode];
  const t0 = performance.now();
  let actual: Outcome = 'ok';
  let error: string | undefined;
  let detail: string | undefined;
  let value: T | undefined;
  try {
    value = await fn();
    if (show) detail = short(show(value));
  } catch (e) {
    ({ actual, error } = classify(e));
    // Kept for the console too: the report carries text, the console the object.
    console.warn(`[conformance] ${area} / ${name} (${rc.mode}):`, e);
  }
  const ms = Math.round(performance.now() - t0);
  rc.record({
    name: `${area} / ${name}`,
    area,
    run: rc.run,
    mode: rc.mode,
    session: rc.session,
    expected,
    actual,
    pass: actual === expected,
    ...(error !== undefined ? { error } : {}),
    ...(detail !== undefined ? { detail } : {}),
    ms,
  });
  return actual === 'ok' ? value : undefined;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `fn` until `ok(value)` or `timeoutMs`. For reads of something another
 * node wrote: the write landed where it was made, and the reader's node gets it
 * by sync, which takes a moment. The last error or value is what fails.
 */
export async function eventually<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  what: string,
  timeoutMs = 30_000,
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
    await sleep(1000);
  }
}
