import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatTyping, useEphemeralPresence } from "./useEphemeralPresence";

// The hook publishes through mero-react's `useEphemeral`. Record which context
// each publish went to, so a slice published into the context being *left* is
// distinguishable from one published into the context being entered.
const publishes: Array<{ ctx: string | null; slice: Record<string, unknown> }> = [];

vi.mock("@calimero-network/mero-react", () => ({
  useEphemeral: (contextId: string | null) => ({
    peers: new Map(),
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
