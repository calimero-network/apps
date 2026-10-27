import { describe, it, expect, beforeEach, vi } from "vitest";
import { RpcError, HTTPError } from "@calimero-apps/cloud";
import { decodeContractError, parseRpcOutput, rpcCall, rpcRaw, RpcCallError } from "./rpc";
import { setContextId, setNodeUrl } from "../lib/mero";

// The cluster's transport, stood in at the client: on Calimero Cloud every call
// is sealed to an attested node, so there is no `/jsonrpc` body on the wire to
// assert. `execute` answers what the app returned, or throws v1's `RpcError`
// for the app's own refusal, as the cloud client does.
const execute = vi.hoisted(() => vi.fn());
vi.mock("../lib/mero", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mero")>();
  return {
    ...actual,
    getMeroClient: () => (actual.getNodeUrl() ? { rpc: { execute } } : null),
  };
});

/** A UTF-8 byte array, the shape older nodes return `output` (and errors) as. */
const bytes = (value: unknown) => [...new TextEncoder().encode(JSON.stringify(value))];

beforeEach(() => {
  localStorage.clear();
  execute.mockReset();
  setNodeUrl("http://localhost:2528");
  setContextId("ctx-1");
});

describe("parseRpcOutput", () => {
  it("passes an already-parsed object through — newer nodes send this", () => {
    expect(parseRpcOutput({ a: 1 })).toEqual({ a: 1 });
  });

  it("decodes a UTF-8 byte array — older nodes send this", () => {
    expect(parseRpcOutput(bytes({ key: "value" }))).toEqual({ key: "value" });
    expect(parseRpcOutput(bytes("plain string"))).toBe("plain string");
    expect(parseRpcOutput(bytes(42))).toBe(42);
  });

  it("keeps an array of objects as an array, not as bytes", () => {
    const rows = [{ id: 1 }, { id: 2 }];
    expect(parseRpcOutput(rows)).toEqual(rows);
  });

  it("keeps an empty array as an empty array, NOT null", () => {
    // Regression: this used to return `null`, which broke every list-returning
    // method on an empty collection. `typeof null === "object"`, so the failure
    // surfaced as "expected array, got object" — naming neither the method nor
    // the cause — and the file panels assigned `null` into state typed
    // `FileRecord[]`.
    expect(parseRpcOutput([])).toEqual([]);
    expect(Array.isArray(parseRpcOutput([]))).toBe(true);
  });

  it("parses a JSON string, and keeps a non-JSON string as-is", () => {
    expect(parseRpcOutput('{"a":1}')).toEqual({ a: 1 });
    expect(parseRpcOutput("just text")).toBe("just text");
  });

  it("maps null and undefined to null", () => {
    expect(parseRpcOutput(null)).toBeNull();
    expect(parseRpcOutput(undefined)).toBeNull();
  });

  it("survives a byte array that is not valid JSON", () => {
    expect(parseRpcOutput([104, 105])).toBe("hi");
  });
});

describe("decodeContractError", () => {
  it("decodes the byte array an app::bail! arrives as", () => {
    const encoded = bytes("that key is frozen").join(", ");
    expect(decodeContractError(`the method call returned an error: [${encoded}]`))
      .toBe("that key is frozen");
  });

  it("decodes the text an app::bail! arrives as from core rc.81", () => {
    expect(decodeContractError('the method call returned an error: "that key is frozen"'))
      .toBe("that key is frozen");
  });

  it("reads the same message whether the node sent text or bytes", () => {
    const encoded = bytes("that key is frozen").join(", ");
    expect(decodeContractError(`the method call returned an error: [${encoded}]`))
      .toBe(decodeContractError('the method call returned an error: "that key is frozen"'));
  });

  it("shows a plain message behind the prefix without the prefix", () => {
    expect(decodeContractError("the method call returned an error: unauthorized")).toBe("unauthorized");
  });

  it("leaves a plain message alone", () => {
    expect(decodeContractError("unauthorized")).toBe("unauthorized");
  });

  it("leaves a byte-like list that is out of range alone", () => {
    expect(decodeContractError("values [1, 2, 999]")).toBe("values [1, 2, 999]");
  });
});

describe("rpcRaw", () => {
  it("calls the method in the selected context and keeps the envelope, output parsed", async () => {
    execute.mockResolvedValue(bytes({ ok: true }));
    const envelope = await rpcRaw("entries", { key: "k" });
    expect(execute).toHaveBeenCalledWith({ contextId: "ctx-1", method: "entries", argsJson: { key: "k" } });
    expect(envelope.result?.output).toEqual({ ok: true });
  });

  it("does not send an executorPublicKey — the cluster reads the caller from the session", async () => {
    execute.mockResolvedValue(null);
    await rpcRaw("len");
    expect(execute.mock.calls[0]![0]).not.toHaveProperty("executorPublicKey");
  });

  it("returns a contract error as `error` instead of throwing — the UI shows it", async () => {
    execute.mockRejectedValue(new RpcError(-32000, "key is frozen", "key is frozen", "ExecutionError"));
    const envelope = await rpcRaw("set", { key: "k", value: "v" });
    expect(envelope.error).toMatchObject({ message: "key is frozen" });
    expect(envelope.result).toBeUndefined();
  });

  it("explains a missing node instead of calling nowhere", async () => {
    localStorage.clear();
    await expect(rpcRaw("len")).rejects.toThrow(/connect to a node/i);
  });

  it("explains a missing context instead of sending an empty one", async () => {
    setContextId("");
    await expect(rpcRaw("len")).rejects.toThrow(/Setup Wizard/);
  });

  it("accepts an explicit context id, for a call against another context", async () => {
    execute.mockResolvedValue(null);
    await rpcRaw("len", {}, "ctx-other");
    expect(execute.mock.calls[0]![0]).toMatchObject({ contextId: "ctx-other" });
  });

  it("throws on a transport failure, naming the status", async () => {
    execute.mockRejectedValue(new HTTPError(503, "Service Unavailable", "", new Headers(), ""));
    await expect(rpcRaw("len")).rejects.toThrow(/503/);
  });
});

describe("rpcCall", () => {
  it("returns the value for code that wants one", async () => {
    execute.mockResolvedValue(bytes({ device_id: "d", account_id: "a" }));
    await expect(rpcCall("whoami")).resolves.toEqual({ device_id: "d", account_id: "a" });
  });

  it("throws the contract's own message, decoded", async () => {
    const encoded = bytes("that key is frozen").join(", ");
    const data = `the method call returned an error: [${encoded}]`;
    execute.mockRejectedValue(new RpcError(-32000, data, data));
    await expect(rpcCall("set")).rejects.toThrow("that key is frozen");
  });

  it("names the method on the error, so a failure is traceable", async () => {
    execute.mockRejectedValue(new RpcError(-32000, "nope"));
    await expect(rpcCall("remove")).rejects.toMatchObject({ name: "RpcCallError", method: "remove" });
    expect(new RpcCallError("x", "m").method).toBe("m");
  });

  it("returns null when the app answers with no output", async () => {
    execute.mockResolvedValue(null);
    await expect(rpcCall("clear")).resolves.toBeNull();
  });

  it("keeps the app's `data` on a contract error, where the bail message lives", async () => {
    const encoded = bytes("nope").join(", ");
    const data = `the method call returned an error: [${encoded}]`;
    execute.mockRejectedValue(new RpcError(-32000, data, data, "FunctionCallError"));
    const envelope = await rpcRaw("set");
    expect(envelope.error).toMatchObject({
      type: "FunctionCallError",
      data: expect.stringContaining("the method call returned an error"),
    });
  });
});
