import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presenceState } from "@calimero-network/mero-js";
import { CURSOR_THROTTLE_MS, HEARTBEAT_MS, IDLE_MS, cursorsOf, decodeCursor, usePresenceCursors } from "./usePresenceCursors";

const published: Array<string | null> = [];
vi.mock("../api/client", () => ({
  peekApi: () => ({
    accountId: "acct-me",
    after: () => {},
    client: {
      apps: {
        presencePublish: (args: { state: string | null }) => {
          published.push(args.state);
          return Promise.resolve();
        },
      },
      // A stream that stays open, with nothing on it, until the hook closes it.
      presenceStream: (_app: string, signal: AbortSignal) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<never>>((resolve) => signal.addEventListener("abort", () => resolve({ done: true, value: undefined }))),
        }),
      }),
    },
  }),
}));

const hex = (v: unknown) => presenceState(new TextEncoder().encode(JSON.stringify(v)));
const entry = (account: string, device: string, state: string | null) =>
  ({ account, device, state }) as Parameters<typeof cursorsOf>[0] extends Iterable<infer E> ? E : never;

describe("live pointers from presence", () => {
  it("reads a pointer back from the hex the node keeps", () => {
    expect(decodeCursor(hex({ x: 12, y: 40 }))).toEqual({ x: 12, y: 40 });
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("zz")).toBeNull();
    expect(decodeCursor(hex({ typing: true }))).toBeNull();
  });

  it("lists everyone else's pointers, one per device, never your own", () => {
    const out = cursorsOf(
      [
        entry("acct-me", "d1", hex({ x: 1, y: 1 })),
        entry("acct-bob", "d2", hex({ x: 5, y: 6 })),
        entry("acct-bob", "d3", hex({ x: 7, y: 8 })),
        entry("acct-cy", "d4", hex({ nope: 1 })),
      ],
      { account: "acct-me" },
      1000,
    );
    expect(out).toEqual([
      { identity: "acct-bob/d2", account: "acct-bob", x: 5, y: 6, updatedAt: 1000 },
      { identity: "acct-bob/d3", account: "acct-bob", x: 7, y: 8, updatedAt: 1000 },
    ]);
  });
});

describe("your pointer on presence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    published.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("is taken back when the pointer leaves the board, and no longer sent", () => {
    const { result } = renderHook(() => usePresenceCursors("app-1"));
    act(() => result.current.move(10, 20));
    act(() => void vi.advanceTimersByTime(CURSOR_THROTTLE_MS));
    expect(published).toEqual([hex({ x: 10, y: 20 })]);
    act(() => result.current.leave());
    expect(published[published.length - 1]).toBeNull();
    const sent = published.length;
    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 5));
    expect(published.length).toBe(sent);
  });

  it("stops the heartbeat once the pointer stands still", () => {
    const { result } = renderHook(() => usePresenceCursors("app-1"));
    act(() => result.current.move(1, 2));
    act(() => void vi.advanceTimersByTime(IDLE_MS + HEARTBEAT_MS * 2));
    expect(published[published.length - 1]).toBeNull();
    const sent = published.length;
    act(() => void vi.advanceTimersByTime(HEARTBEAT_MS * 10));
    expect(published.length).toBe(sent);
  });
});
