/**
 * Pins the suppression rule.
 *
 * The important half of this suite is the NEGATIVE half. The naive fix for
 * "joining shows twenty error toasts" is to stop reporting read errors, which
 * turns a genuinely broken context into a silent empty board — a worse bug,
 * and a much harder one to report. So most of what is asserted here is which
 * errors must STILL get through.
 */
import { describe, expect, it } from 'vitest';
import {
  WARMUP_GRACE_MS,
  classifyReadError,
  isContextWarmingUp,
} from './contextReadiness';

/** How the node delivers a contract failure: ASCII bytes inside a wrapper. */
const asNodeBytes = (text: string) =>
  `the method call returned an error: [${[...text].map((c) => c.charCodeAt(0)).join(', ')}]`;

describe('isContextWarmingUp — the transient conditions', () => {
  it('matches core’s Uninitialized message', () => {
    expect(
      isContextWarmingUp(new Error('context state not initialized, awaiting state sync')),
    ).toBe(true);
  });

  it('matches core’s GroupKeyPending message', () => {
    expect(
      isContextWarmingUp(
        new Error("group key not yet delivered for context 'abc' — retry shortly"),
      ),
    ).toBe(true);
  });

  it('matches the serde tag, which is how ExecuteError is actually encoded', () => {
    // #[serde(tag = "type", content = "data")]
    expect(isContextWarmingUp({ type: 'Uninitialized' })).toBe(true);
    expect(
      isContextWarmingUp({ type: 'GroupKeyPending', data: { contextId: 'abc' } }),
    ).toBe(true);
  });

  it('finds the tag nested inside an RPC error envelope', () => {
    expect(
      isContextWarmingUp({ message: 'rpc failed', data: { type: 'Uninitialized' } }),
    ).toBe(true);
    expect(
      isContextWarmingUp({ message: 'rpc failed', cause: { kind: 'Uninitialized' } }),
    ).toBe(true);
  });

  it('sees through the node’s ASCII byte-array wrapper', () => {
    // The phrase is not in `err.message` until those bytes are decoded, which is
    // exactly the form the burst of toasts arrived in.
    expect(
      isContextWarmingUp(new Error(asNodeBytes('context state not initialized, awaiting state sync'))),
    ).toBe(true);
  });

  it('is case-insensitive about the tag', () => {
    expect(isContextWarmingUp({ type: 'uninitialized' })).toBe(true);
  });
});

describe('isContextWarmingUp — what must STILL be reported', () => {
  it('does not swallow a contract error', () => {
    expect(
      isContextWarmingUp(new Error(asNodeBytes('{"kind":"Forbidden","data":"delete: caller is not the owner"}'))),
    ).toBe(false);
    expect(isContextWarmingUp(new Error('not found: issue-123'))).toBe(false);
  });

  it('does not swallow the OTHER execute failures, which are real', () => {
    // These land in the same window as a join and look similar from a distance,
    // but none of them clears by waiting.
    expect(isContextWarmingUp({ type: 'ContextNotFound' })).toBe(false);
    expect(isContextWarmingUp({ type: 'Unauthorized' })).toBe(false);
    expect(isContextWarmingUp({ type: 'ApplicationNotInstalled' })).toBe(false);
    expect(isContextWarmingUp({ type: 'InternalError' })).toBe(false);
    expect(
      isContextWarmingUp(new Error("application not installed: 'abc'")),
    ).toBe(false);
  });

  it('does not swallow a transport or auth failure', () => {
    expect(isContextWarmingUp(new Error('Failed to fetch'))).toBe(false);
    expect(isContextWarmingUp(new Error('401 Unauthorized'))).toBe(false);
    expect(isContextWarmingUp({ type: 'NetworkError', message: 'socket hang up' })).toBe(false);
  });

  it('does not match on the bare word "uninitialized" in prose', () => {
    // Matching a single word would make any message mentioning it disappear.
    // Core's phrasing is matched in full for exactly this reason.
    expect(
      isContextWarmingUp(new Error('failed to parse field `uninitialized` in the manifest')),
    ).toBe(false);
  });

  it('treats nothing as not-warming-up', () => {
    expect(isContextWarmingUp(null)).toBe(false);
    expect(isContextWarmingUp(undefined)).toBe(false);
    expect(isContextWarmingUp('')).toBe(false);
  });

  it('survives an unserialisable error without claiming it is transient', () => {
    const circular: Record<string, unknown> = { message: 'boom' };
    circular.self = circular;
    expect(isContextWarmingUp(circular)).toBe(false);
  });
});

describe('classifyReadError — the suppression rule, clock included', () => {
  const T0 = 1_000_000;
  const transient = new Error('context state not initialized, awaiting state sync');
  const real = new Error('not found: issue-123');

  it('reports a real error immediately, and starts no clock', () => {
    const out = classifyReadError(real, null, T0);
    expect(out.error).toBe(real);
    expect(out.warmingUp).toBe(false);
    expect(out.warmingSince).toBeNull();
  });

  it('reports a real error even while a warm-up was already running', () => {
    // A genuine failure arriving mid-join must not inherit the reprieve.
    const out = classifyReadError(real, T0, T0 + 1_000);
    expect(out.error).toBe(real);
    expect(out.warmingUp).toBe(false);
    expect(out.warmingSince).toBeNull();
  });

  it('withholds the first transient failure and starts the clock', () => {
    const out = classifyReadError(transient, null, T0);
    expect(out.error).toBeNull();
    expect(out.warmingUp).toBe(true);
    expect(out.warmingSince).toBe(T0);
  });

  it('keeps withholding, and keeps the ORIGINAL start time, during a join', () => {
    // Resetting the clock on each failure is how a suppression becomes
    // permanent: it could never expire.
    const out = classifyReadError(transient, T0, T0 + 10_000);
    expect(out.error).toBeNull();
    expect(out.warmingUp).toBe(true);
    expect(out.warmingSince).toBe(T0);
  });

  it('PROMOTES a warm-up that never clears into a real error', () => {
    const out = classifyReadError(transient, T0, T0 + WARMUP_GRACE_MS + 1);
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error?.message).toContain('not initialized');
    // Still flagged as warming up: it is both "syncing" and "this is now wrong".
    expect(out.warmingUp).toBe(true);
  });

  it('does not promote exactly ON the grace boundary', () => {
    expect(classifyReadError(transient, T0, T0 + WARMUP_GRACE_MS).error).toBeNull();
  });

  it('wraps a non-Error rejection so callers always get an Error', () => {
    const out = classifyReadError('a string rejection', null, T0);
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error?.message).toBe('a string rejection');
  });
});
