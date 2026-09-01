import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isMethodKnownMissing, isMethodNotFoundError, resetMethodSupport, rpcWithFallback,
} from "./compat";

// The bug this exists for: a document created before an app upgrade keeps the old
// WASM for life, so calling a newly added method answers
//   method "move_layers" not found
// and grouping failed outright.

beforeEach(() => resetMethodSupport());

const notFound = (name: string) => new Error(`method "${name}" not found`);

describe("isMethodNotFoundError", () => {
  it("recognises the runtime's wording", () => {
    expect(isMethodNotFoundError(notFound("move_layers"))).toBe(true);
    expect(isMethodNotFoundError(new Error('method "update_transform" not found'))).toBe(true);
  });

  it("matches a message wrapped by the RPC layer", () => {
    expect(isMethodNotFoundError(
      new Error('the method call returned an error: method "move_layers" not found'),
    )).toBe(true);
  });

  it("accepts a bare string, which is what a JSON-RPC error body can be", () => {
    expect(isMethodNotFoundError('method "x" not found')).toBe(true);
  });

  it("does NOT match other failures", () => {
    for (const other of [
      new Error("unauthorized: caller is not an editor"),
      new Error("invalid type: floating point `1.5`, expected i64"),
      new Error("Network Error"),
      new Error("key not found"),          // storage miss, not a missing method
      null,
      undefined,
    ]) {
      expect(isMethodNotFoundError(other), String(other)).toBe(false);
    }
  });
});

describe("rpcWithFallback", () => {
  it("uses the primary path when the contract has the method", async () => {
    const primary = vi.fn().mockResolvedValue("new");
    const fallback = vi.fn().mockResolvedValue("old");
    await expect(rpcWithFallback("move_layers", primary, fallback)).resolves.toBe("new");
    expect(fallback).not.toHaveBeenCalled();
    expect(isMethodKnownMissing("move_layers")).toBe(false);
  });

  it("falls back when the method is missing, and says so once", async () => {
    const primary = vi.fn().mockRejectedValue(notFound("move_layers"));
    const fallback = vi.fn().mockResolvedValue("old");
    const onFallback = vi.fn();

    await expect(rpcWithFallback("move_layers", primary, fallback, onFallback)).resolves.toBe("old");
    expect(onFallback).toHaveBeenCalledWith("move_layers");
    expect(isMethodKnownMissing("move_layers")).toBe(true);
  });

  it("stops retrying a method it already knows is missing", async () => {
    const primary = vi.fn().mockRejectedValue(notFound("move_layers"));
    const fallback = vi.fn().mockResolvedValue("old");
    const onFallback = vi.fn();

    for (let i = 0; i < 3; i++) {
      await rpcWithFallback("move_layers", primary, fallback, onFallback);
    }
    // The failed call happens once; the notice fires once; the fallback runs each time.
    expect(primary).toHaveBeenCalledTimes(1);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(3);
  });

  it("keeps a verdict per method name", async () => {
    await rpcWithFallback("move_layers",
      () => Promise.reject(notFound("move_layers")), () => Promise.resolve("old"));
    expect(isMethodKnownMissing("move_layers")).toBe(true);
    expect(isMethodKnownMissing("update_transform")).toBe(false);
  });

  it("propagates any other error instead of silently taking the old path", async () => {
    const primary = vi.fn().mockRejectedValue(new Error("unauthorized: not an editor"));
    const fallback = vi.fn().mockResolvedValue("old");
    await expect(rpcWithFallback("move_layers", primary, fallback))
      .rejects.toThrow("unauthorized");
    expect(fallback).not.toHaveBeenCalled();
    // …and a permission problem must not be remembered as "no such method"
    expect(isMethodKnownMissing("move_layers")).toBe(false);
  });

  it("lets a failing fallback surface its own error", async () => {
    await expect(rpcWithFallback(
      "move_layers",
      () => Promise.reject(notFound("move_layers")),
      () => Promise.reject(new Error("move_layer also failed")),
    )).rejects.toThrow("move_layer also failed");
  });

  it("resetMethodSupport re-probes — a different project may run a newer build", async () => {
    const primary = vi.fn()
      .mockRejectedValueOnce(notFound("move_layers"))
      .mockResolvedValueOnce("new");
    const fallback = vi.fn().mockResolvedValue("old");

    await rpcWithFallback("move_layers", primary, fallback);
    expect(isMethodKnownMissing("move_layers")).toBe(true);

    resetMethodSupport();
    await expect(rpcWithFallback("move_layers", primary, fallback)).resolves.toBe("new");
  });
});
