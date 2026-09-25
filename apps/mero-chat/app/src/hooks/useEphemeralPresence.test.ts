import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatTyping,
  TYPING_STALE_MS,
  useEphemeralPresence,
} from "./useEphemeralPresence";

// The hook publishes through mero-react's `useEphemeral`. Record which context
// each publish went to, so a slice published into the context being *left* is
// distinguishable from one published into the context being entered.
const publishes: Array<{ ctx: string | null; slice: Record<string, unknown> }> = [];

let peersFixture = new Map<string, Record<string, unknown>>();

vi.mock("@calimero-network/mero-react", () => ({
  useEphemeral: (contextId: string | null) => ({
    peers: peersFixture,
    ageOf: () => undefined,
    error: null,
    setPresence: (slice: Record<string, unknown>) =>
      publishes.push({ ctx: contextId, slice }),
  }),
}));

describe("formatTyping", () => {
  it("renders nothing when nobody is typing", () => {
    expect(formatTyping([])).toBe("");
  });

  it("names a single typist", () => {
    expect(formatTyping(["Ana"])).toBe("Ana is typing…");
  });

  it("names both when exactly two distinct people type", () => {
    expect(formatTyping(["Ana", "Bo"])).toBe("Ana and Bo are typing…");
  });

  it("counts instead of naming beyond two", () => {
    expect(formatTyping(["Ana", "Bo", "Cy"])).toBe("3 people are typing…");
  });

  // Two peers who have not set a display name both render as the anonymous
  // label; naming them would read "Someone and Someone".
  it("collapses to a count when two names are identical", () => {
    expect(formatTyping(["Someone", "Someone"])).toBe("2 people are typing…");
  });
});

describe("useEphemeralPresence — leaving a context while typing", () => {
  beforeEach(() => {
    publishes.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression: user types in ctx-a, then switches to ctx-b before the idle
  // timer fires. Peers kept rendering "typing" in ctx-a indefinitely — the
  // switch cancelled the timer that would have published typing:false, and the
  // node re-publishes every locally-set slice every ~2.5s, so the TTL never
  // expires the stale one.
  it("publishes typing:false into the context being left", () => {
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: string }) => useEphemeralPresence(ctx),
      { initialProps: { ctx: "ctx-a" } },
    );

    act(() => {
      result.current.noteTyping();
    });
    expect(
      publishes.some((p) => p.ctx === "ctx-a" && p.slice.typing === true),
    ).toBe(true);

    publishes.length = 0;
    rerender({ ctx: "ctx-b" });

    expect(
      publishes.some((p) => p.ctx === "ctx-a" && p.slice.typing === false),
    ).toBe(true);
  });

  it("does not announce typing into the context being entered", () => {
    const { result, rerender } = renderHook(
      ({ ctx }: { ctx: string }) => useEphemeralPresence(ctx),
      { initialProps: { ctx: "ctx-a" } },
    );
    act(() => {
      result.current.noteTyping();
    });
    publishes.length = 0;
    rerender({ ctx: "ctx-b" });

    expect(
      publishes.some((p) => p.ctx === "ctx-b" && p.slice.typing === true),
    ).toBe(false);
  });
});

describe("useEphemeralPresence — a peer that goes away without retracting", () => {
  beforeEach(() => {
    publishes.length = 0;
    peersFixture = new Map();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The node re-publishes every locally-set slice on its own ~2.5s heartbeat,
  // so a force-quit / crashed / disconnected client's `typing: true` is kept
  // alive indefinitely — the 7s node-side TTL never fires because the node,
  // not the client, is the thing being kept alive. Verified against a live
  // rig: a peer published typing:true once, went silent, and no removal
  // arrived in 20s. So staleness must be decided here.
  it("stops reporting a peer as typing once their claim goes stale", () => {
    peersFixture = new Map([["peer-1", { name: "Ana", typing: true }]]);
    const { result, rerender } = renderHook(() => useEphemeralPresence("ctx-a"));
    expect(result.current.typing).toEqual(["Ana"]);

    // The node keeps republishing the identical slice; no fresh keystroke.
    act(() => {
      vi.advanceTimersByTime(TYPING_STALE_MS + 500);
    });
    rerender();

    expect(result.current.typing).toEqual([]);
  });

  it("keeps reporting a peer whose claim is refreshed by a real change", () => {
    peersFixture = new Map([["peer-1", { name: "Ana", typing: true }]]);
    const { result, rerender } = renderHook(() => useEphemeralPresence("ctx-a"));

    act(() => {
      vi.advanceTimersByTime(TYPING_STALE_MS - 1_000);
    });
    // A genuine new keystroke: the peer re-asserts with a changed slice.
    peersFixture = new Map([["peer-1", { name: "Ana", typing: true, seq: 2 }]]);
    rerender();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    rerender();

    expect(result.current.typing).toEqual(["Ana"]);
  });
});
