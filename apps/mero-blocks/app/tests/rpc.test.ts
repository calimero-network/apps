import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeOutput, extractRpcError, rpcExecute } from "../src/net/rpc";

const target = {
  nodeUrl: "http://localhost:2430",
  contextId: "ctx-1",
  getToken: () => "tok-123",
};

const okResponse = (result: unknown) =>
  ({
    ok: true,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  }) as Response;

afterEach(() => vi.restoreAllMocks());

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

describe("rpcExecute wire shape", () => {
  it("POSTs the camelCase envelope with argsJson as a raw object", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ output: null }));
    await rpcExecute(target, "set_blocks", { edits: [{ x: 1, y: 2, z: 3, b: 4 }], now: 123 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:2430/jsonrpc");
    expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer tok-123");
    const body = JSON.parse(init!.body as string);
    expect(body.method).toBe("execute");
    expect(body.params.contextId).toBe("ctx-1"); // camelCase, not context_id
    expect(body.params.method).toBe("set_blocks");
    expect(body.params.argsJson).toEqual({ edits: [{ x: 1, y: 2, z: 3, b: 4 }], now: 123 });
    expect(typeof body.params.argsJson).toBe("object"); // NOT a JSON string
  });

  // The regression this file did not have. `executorPublicKey` used to be
  // spread into `params` whenever the session carried one — so a target
  // WITHOUT an identity (every other case here, and every route-mocked e2e)
  // sent the correct three keys and passed, while a real logged-in session
  // sent four and got
  //   rpc world_meta: unknown field `executorPublicKey`,
  //   expected one of `contextId`, `method`, `argsJson`
  // from core's `deny_unknown_fields`. Asserting the keys that SHOULD be there
  // cannot catch that; only asserting that nothing else is can, and only with
  // an identity on the target.
  it("sends exactly contextId/method/argsJson even when the session has an identity", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(okResponse({ output: null }));
    await rpcExecute(
      { ...target, executorPublicKey: "a".repeat(64) },
      "world_meta",
      {},
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(Object.keys(body.params).sort()).toEqual(["argsJson", "contextId", "method"]);
  });

  it("decodes byte-array outputs from the node", async () => {
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify([{ k: "0,1,0", b: 3 }])));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse({ output: bytes }));
    const out = await rpcExecute(target, "get_overrides", {});
    expect(out).toEqual([{ k: "0,1,0", b: 3 }]);
  });

  it("throws the WASM error reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ error: { data: "too many edits in one batch" } }),
    } as Response);
    await expect(rpcExecute(target, "set_blocks", {})).rejects.toThrow(/too many edits/);
  });

  it("throws on HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, status: 401 } as Response);
    await expect(rpcExecute(target, "world_meta", {})).rejects.toThrow(/401/);
  });
});
