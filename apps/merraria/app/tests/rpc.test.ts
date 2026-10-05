import { describe, expect, it, vi } from "vitest";
import { RpcError, type ExecuteParams, type ExecuteTransport } from "@calimero-network/mero-js";
import { bindExec, decodeOutput, describeExecError, extractRpcError } from "../src/net/rpc";

describe("decodeOutput", () => {
  it("decodes a legacy u8[] byte array", () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify({ seed: 7 })));
    expect(decodeOutput(bytes)).toEqual({ seed: 7 });
  });

  it("parses a JSON string", () => {
    expect(decodeOutput('{"a":1}')).toEqual({ a: 1 });
  });

  it("keeps a non-JSON string as-is", () => {
    expect(decodeOutput("hello")).toBe("hello");
  });

  it("passes through already-parsed values", () => {
    expect(decodeOutput([{ k: "1,2,3", b: 4 }])).toEqual([{ k: "1,2,3", b: 4 }]);
    expect(decodeOutput(null)).toBeNull();
  });
});

describe("extractRpcError", () => {
  it("prefers error.data (the WASM reason)", () => {
    expect(extractRpcError({ error: { data: "too many edits", message: "execution failed" } }))
      .toBe("too many edits");
  });
  it("falls back to error.message", () => {
    expect(extractRpcError({ error: { message: "boom" } })).toBe("boom");
  });
  it("returns null when there is no error", () => {
    expect(extractRpcError({ result: {} })).toBeNull();
  });
});

/** an ExecuteTransport that records what it was handed and answers `output` */
function fakeRpc(output: unknown | (() => never)) {
  const calls: ExecuteParams[] = [];
  const rpc: ExecuteTransport = {
    kind: "node",
    canSubscribe: true,
    execute: vi.fn(async (params: ExecuteParams) => {
      calls.push(params);
      if (typeof output === "function") (output as () => never)();
      return output;
    }) as ExecuteTransport["execute"],
    executeWithMetadata: vi.fn(),
    migrateMyEntries: vi.fn(),
    countMyPending: vi.fn(),
  };
  return { rpc, calls };
}

describe("bindExec (the contract-call shape handed to mero-js)", () => {
  it("hands mero-js exactly contextId/method/argsJson, argsJson as a raw object", async () => {
    const { rpc, calls } = fakeRpc(null);
    await bindExec(rpc, "ctx-1")("set_tiles", { edits: [{ x: 1, y: 2, t: 3 }], now: 123 });
    expect(calls).toHaveLength(1);
    // Core's `ExecutionRequest` is `deny_unknown_fields`: a fourth key
    // (`executorPublicKey` once) is a 400 for the whole call. Assert the key
    // SET, not just the keys we want.
    expect(Object.keys(calls[0]).sort()).toEqual(["argsJson", "contextId", "method"]);
    expect(calls[0].contextId).toBe("ctx-1"); // camelCase, not context_id
    expect(calls[0].method).toBe("set_tiles");
    expect(calls[0].argsJson).toEqual({ edits: [{ x: 1, y: 2, t: 3 }], now: 123 });
    expect(typeof calls[0].argsJson).toBe("object"); // NOT a JSON string
  });

  it("decodes byte-array outputs from the node", async () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify([{ k: "0,1", t: 3 }])));
    const { rpc } = fakeRpc(bytes);
    expect(await bindExec(rpc, "ctx")("get_overrides", {})).toEqual([{ k: "0,1", t: 3 }]);
  });

  it("passes parsed outputs through (the relay's query route answers JSON)", async () => {
    const { rpc } = fakeRpc({ name: "w", seed: 4, createdAt: 1 });
    expect(await bindExec(rpc, "ctx")("world_meta", {})).toEqual({ name: "w", seed: 4, createdAt: 1 });
  });

  it("throws the WASM error reason, prefixed with the method", async () => {
    const { rpc } = fakeRpc(() => {
      throw new RpcError(-32000, "execution failed", "too many edits in one batch", "ExecutionError");
    });
    await expect(bindExec(rpc, "ctx")("set_tiles", {})).rejects.toThrow(/^rpc set_tiles: too many edits/);
  });

  it("keeps the contract's typed refusal readable, so boot() can wait on Uninitialized", async () => {
    const { rpc } = fakeRpc(() => {
      throw new RpcError(-32000, "execution failed", { type: "Uninitialized" }, "ExecutionError");
    });
    const err = await bindExec(rpc, "ctx")("world_meta", {}).catch((e: Error) => e);
    expect(String(err)).toMatch(/"type"\s*:\s*"Uninitialized"/);
  });

  it("surfaces transport failures (HTTP, a refused warrant) as they are", async () => {
    const { rpc } = fakeRpc(() => {
      throw new Error("HTTP 401 Unauthorized");
    });
    await expect(bindExec(rpc, "ctx")("world_meta", {})).rejects.toThrow(/rpc world_meta: HTTP 401/);
    expect(describeExecError("plain")).toBe("plain");
  });
});
