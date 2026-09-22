import { describe, it, expect } from 'vitest';
import { EchoGuard } from '../echo';

const run = (replica: string, counter: number, len: number) => ({
  replica,
  counter,
  len,
});

describe('EchoGuard', () => {
  it('calls a run it minted itself an echo', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 3)]);
    expect(guard.isEcho([run('7', 5, 3)])).toBe(true);
  });

  it('calls a sub-range of one of its own runs an echo', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 10)]);
    expect(guard.isEcho([run('7', 7, 2)])).toBe(true);
  });

  it('spans two adjacent runs it remembered', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 2), run('7', 7, 3)]);
    expect(guard.isEcho([run('7', 5, 5)])).toBe(true);
  });

  it('calls a partial overlap remote', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 2)]);
    expect(guard.isEcho([run('7', 5, 3)])).toBe(false);
  });

  it('calls a set with one foreign run remote', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 3)]);
    expect(guard.isEcho([run('7', 5, 3), run('9', 1, 1)])).toBe(false);
  });

  it('calls another replica remote', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 3)]);
    expect(guard.isEcho([run('9', 5, 3)])).toBe(false);
  });

  it('calls an empty run list remote rather than swallowing it', () => {
    const guard = new EchoGuard();
    guard.remember([run('7', 5, 3)]);
    expect(guard.isEcho([])).toBe(false);
    expect(guard.isEcho([run('7', 5, 0)])).toBe(false);
  });

  it('forgets the oldest runs past its limit', () => {
    const guard = new EchoGuard(2);
    guard.remember([run('7', 1, 1)]);
    guard.remember([run('7', 2, 1)]);
    guard.remember([run('7', 3, 1)]);
    expect(guard.isEcho([run('7', 1, 1)])).toBe(false);
    expect(guard.isEcho([run('7', 3, 1)])).toBe(true);
  });
});
