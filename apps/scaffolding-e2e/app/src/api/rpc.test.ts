import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { decodeContractError, parseRpcOutput, rpcCall, rpcRaw, RpcCallError } from "./rpc";
import { setContextId, setNodeUrl } from "../lib/mero";

/** Reply to the next fetch with a JSON-RPC body. */
function reply(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

/** A UTF-8 byte array, the shape older nodes return `output` (and errors) as. */
const bytes = (value: unknown) => [...new TextEncoder().encode(JSON.stringify(value))];

beforeEach(() => {
  localStorage.clear();
  setNodeUrl("http://localhost:2528");
  setContextId("ctx-1");
});
afterEach(() => vi.unstubAllGlobals());

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

  it("treats an empty array as no value", () => {
    expect(parseRpcOutput([])).toBeNull();
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

  it("leaves a plain message alone", () => {
    expect(decodeContractError("unauthorized")).toBe("unauthorized");
  });

  it("leaves a byte-like list that is out of range alone", () => {
    expect(decodeContractError("values [1, 2, 999]")).toBe("values [1, 2, 999]");
  });
});

describe("rpcRaw", () => {
  it("posts an execute call to the node with the bearer token", async () => {
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "tok", refresh_token: "r", expires_at: Date.now() + 60_000,
    }));
    const fetchMock = reply({ result: { output: bytes({ ok: true }), logs: [] } });
    vi.stubGlobal("fetch", fetchMock);

    const envelope = await rpcRaw("entries", { key: "k" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:2528/jsonrpc");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toMatchObject({
      method: "execute",
      params: { contextId: "ctx-1", method: "entries", argsJson: { key: "k" } },
    });
    // …and the envelope is preserved, with `output` parsed
    expect(envelope.result?.output).toEqual({ ok: true });
  });

  it("does not send an executorPublicKey — the node reads the caller from the token", async () => {
    const fetchMock = reply({ result: { output: null } });
    vi.stubGlobal("fetch", fetchMock);
    await rpcRaw("len");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.params).not.toHaveProperty("executorPublicKey");
  });

  it("returns a contract error as `error` instead of throwing — the UI shows it", async () => {
    vi.stubGlobal("fetch", reply({ error: { message: "key is frozen" } }));
    const envelope = await rpcRaw("set", { key: "k", value: "v" });
    expect(envelope.error).toEqual({ message: "key is frozen" });
    expect(envelope.result).toBeUndefined();
  });

  it("trims a trailing slash off the node url rather than posting //jsonrpc", async () => {
    setNodeUrl("http://localhost:2528/");
    const fetchMock = reply({ result: { output: null } });
    vi.stubGlobal("fetch", fetchMock);
    await rpcRaw("len");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:2528/jsonrpc");
  });

  it("explains a missing node instead of posting to /jsonrpc", async () => {
    localStorage.clear();
    await expect(rpcRaw("len")).rejects.toThrow(/connect to a node/i);
  });

  it("explains a missing context instead of sending an empty one", async () => {
    setNodeUrl("http://localhost:2528");
    setContextId("");
    await expect(rpcRaw("len")).rejects.toThrow(/Setup Wizard/);
  });

  it("accepts an explicit context id, for a call against another context", async () => {
    const fetchMock = reply({ result: { output: null } });
    vi.stubGlobal("fetch", fetchMock);
    await rpcRaw("len", {}, "ctx-other");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.params.contextId).toBe("ctx-other");
  });

  it("throws on a transport failure", async () => {
    vi.stubGlobal("fetch", reply({}, false, 503));
    await expect(rpcRaw("len")).rejects.toThrow(/503/);
  });
});

describe("rpcCall", () => {
  it("returns the value for code that wants one", async () => {
    vi.stubGlobal("fetch", reply({ result: { output: bytes({ device_id: "d", account_id: "a" }) } }));
    await expect(rpcCall("whoami")).resolves.toEqual({ device_id: "d", account_id: "a" });
  });

  it("throws the contract's own message, decoded", async () => {
    const encoded = bytes("that key is frozen").join(", ");
    vi.stubGlobal("fetch", reply({
      error: { data: `the method call returned an error: [${encoded}]` },
    }));
    await expect(rpcCall("set")).rejects.toThrow("that key is frozen");
  });

  it("names the method on the error, so a failure is traceable", async () => {
    vi.stubGlobal("fetch", reply({ error: { message: "nope" } }));
    await expect(rpcCall("remove")).rejects.toMatchObject({
      name: "RpcCallError", method: "remove",
    });
    expect(new RpcCallError("x", "m").method).toBe("m");
  });

  it("returns null when the node answers with no output", async () => {
    vi.stubGlobal("fetch", reply({ result: { logs: [] } }));
    await expect(rpcCall("clear")).resolves.toBeNull();
  });
});
