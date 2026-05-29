import { describe, it, expect } from "vitest";
import type { CursorState } from "../types";

function normalizeCursor(c: CursorState): CursorState {
  return { ...c, updatedAt: c.updatedAt ?? c.updated_at ?? 0 };
}

describe("normalizeCursor", () => {
  it("passes through updatedAt when already set", () => {
    const c: CursorState = { identity: "alice", x: 100, y: 200, updatedAt: 9999 };
    expect(normalizeCursor(c).updatedAt).toBe(9999);
  });

  it("falls back to updated_at when updatedAt is missing", () => {
    const c = { identity: "alice", x: 100, y: 200, updated_at: 1234 } as unknown as CursorState;
    expect(normalizeCursor(c).updatedAt).toBe(1234);
  });

  it("uses 0 when neither field is present", () => {
    const c = { identity: "alice", x: 100, y: 200 } as unknown as CursorState;
    expect(normalizeCursor(c).updatedAt).toBe(0);
  });

  it("wasm-style response (only updated_at) still passes age filter", () => {
    const now = Date.now();
    const c = { identity: "bob", x: 50, y: 80, updated_at: now } as unknown as CursorState;
    const normalized = normalizeCursor(c);
    expect(now - normalized.updatedAt).toBeLessThan(10_000);
  });

  it("without normalization, wasm snake_case fails age filter", () => {
    const now = Date.now();
    const c = { identity: "bob", x: 50, y: 80, updated_at: now } as unknown as CursorState;
    // updatedAt is undefined → NaN subtraction → not < 10000
    expect(now - c.updatedAt).not.toBeLessThan(10_000);
  });
});
