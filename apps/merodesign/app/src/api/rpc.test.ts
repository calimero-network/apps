import { vi, describe, it, expect, beforeEach } from "vitest";
import axios from "axios";
import { rpcCall, adminGet, adminPost, adminDelete, adminPut, listNamespaces } from "./rpc";

vi.mock("axios");
vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "http://localhost:2430",
  clearAllStorage: vi.fn(),
}));

// Token now lives in the mero token store (localStorage["mero-tokens"]).
beforeEach(() => {
  localStorage.setItem("mero-tokens", JSON.stringify({ access_token: "test-token" }));
});

const mockPost   = vi.mocked(axios.post);
const mockGet    = vi.mocked(axios.get);
const mockDelete = vi.mocked(axios.delete);
const mockPut    = vi.mocked(axios.put);

/** Build a Calimero-style execute response with JSON-encoded output bytes. */
function execResponse(value: unknown) {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return { data: { jsonrpc: "2.0", id: 1, result: { output: bytes, logs: [] } } };
}

function emptyExecResponse() {
  return { data: { jsonrpc: "2.0", id: 1, result: { output: [], logs: [] } } };
}

// ── rpcCall ───────────────────────────────────────────────────────────────────

describe("rpcCall — request format", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue(emptyExecResponse());
  });

  it("POSTs to <nodeUrl>/jsonrpc", async () => {
    await rpcCall("ctx-1", "get_elements", {});
    expect(mockPost.mock.calls[0][0]).toBe("http://localhost:2430/jsonrpc");
  });

  it("sends jsonrpc version '2.0'", async () => {
    await rpcCall("ctx-1", "get_elements", {});
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.jsonrpc).toBe("2.0");
  });

  it("uses outer method='execute' (not 'call')", async () => {
    await rpcCall("ctx-1", "get_elements", {});
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.method).toBe("execute");
    expect(body.method).not.toBe("call");
  });

  it("sends params.contextId (camelCase, not context_id)", async () => {
    await rpcCall("ctx-abc", "get_elements", {});
    const body = mockPost.mock.calls[0][1] as { params: Record<string, unknown> };
    expect(body.params.contextId).toBe("ctx-abc");
    expect(body.params.context_id).toBeUndefined();
  });

  it("sends params.argsJson (camelCase, not args_json)", async () => {
    await rpcCall("ctx-1", "add_element", { id: "el-1" });
    const body = mockPost.mock.calls[0][1] as { params: Record<string, unknown> };
    expect(body.params.argsJson).toBeDefined();
    expect(body.params.args_json).toBeUndefined();
  });

  it("passes args object directly as argsJson (not JSON string)", async () => {
    const args = { id: "el-1", x: 50, y: 100, width: 200 };
    await rpcCall("ctx-1", "update_element", args);
    const body = mockPost.mock.calls[0][1] as { params: { argsJson: Record<string, unknown> } };
    expect(body.params.argsJson).toEqual(args);
  });

  it("sends the inner method name in params.method", async () => {
    await rpcCall("ctx-1", "delete_element", { id: "el-99" });
    const body = mockPost.mock.calls[0][1] as { params: { method: string } };
    expect(body.params.method).toBe("delete_element");
  });

  it("includes Authorization Bearer header", async () => {
    await rpcCall("ctx-1", "get_elements", {});
    const config = mockPost.mock.calls[0][2] as { headers: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer test-token");
  });
});

describe("rpcCall — response parsing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("decodes result.output bytes as JSON", async () => {
    const data = [{ id: "el-1", data: { kind: "rect" }, x: 0, y: 0, width: 100, height: 100 }];
    mockPost.mockResolvedValue(execResponse(data));
    const result = await rpcCall("ctx-1", "get_elements", {});
    expect(result).toEqual(data);
  });

  it("decodes a single object from output bytes", async () => {
    const el = { id: "el-1", data: { kind: "circle" } };
    mockPost.mockResolvedValue(execResponse(el));
    const result = await rpcCall<typeof el>("ctx-1", "get_element", { id: "el-1" });
    expect(result).toEqual(el);
  });

  it("add_element sends lowercase kind", async () => {
    const element = {
      id: "el-1", data: { kind: "rect" }, x: 10, y: 20,
      width: 100, height: 80, rotation: 0, fill: "#fff", stroke: "transparent",
      strokeWidth: 0, opacity: 100, layerIndex: 0,
      createdBy: "", createdAt: 1000, updatedAt: 1000,
    };
    mockPost.mockResolvedValue(emptyExecResponse());
    await rpcCall("ctx-1", "add_element", { element });
    const body = mockPost.mock.calls[0][1] as { params: { argsJson: { element: { data: { kind: string } } } } };
    expect(body.params.argsJson.element.data.kind).toBe("rect");
  });

  it("add_element with circle sends lowercase kind", async () => {
    const element = {
      id: "el-2", data: { kind: "circle" }, x: 0, y: 0,
      width: 50, height: 50, rotation: 0, fill: "#00f", stroke: "transparent",
      strokeWidth: 0, opacity: 100, layerIndex: 1,
      createdBy: "", createdAt: 1000, updatedAt: 1000,
    };
    mockPost.mockResolvedValue(emptyExecResponse());
    await rpcCall("ctx-1", "add_element", { element });
    const body = mockPost.mock.calls[0][1] as { params: { argsJson: { element: { data: { kind: string } } } } };
    expect(body.params.argsJson.element.data.kind).toBe("circle");
    expect(body.params.argsJson.element.data.kind).not.toBe("Circle");
  });

  it("returns null for empty output array", async () => {
    mockPost.mockResolvedValue(emptyExecResponse());
    const result = await rpcCall("ctx-1", "delete_element", { id: "x" });
    expect(result).toBeNull();
  });

  it("decodes boolean true from output", async () => {
    mockPost.mockResolvedValue(execResponse(true));
    const result = await rpcCall<boolean>("ctx-1", "ping", {});
    expect(result).toBe(true);
  });

  it("decodes null value from output bytes", async () => {
    mockPost.mockResolvedValue(execResponse(null));
    const result = await rpcCall("ctx-1", "noop", {});
    expect(result).toBeNull();
  });
});

describe("rpcCall — error handling", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws using error.data when present", async () => {
    mockPost.mockResolvedValue({
      data: { error: { type: "ParseError", data: "missing field `contextId`" } },
    });
    await expect(rpcCall("ctx-1", "foo", {})).rejects.toThrow("missing field `contextId`");
  });

  it("throws using error as string", async () => {
    mockPost.mockResolvedValue({ data: { error: "unauthorized" } });
    await expect(rpcCall("ctx-1", "foo", {})).rejects.toThrow("unauthorized");
  });

  it("throws with stringified error object when no data field", async () => {
    mockPost.mockResolvedValue({
      data: { error: { type: "InternalError" } },
    });
    await expect(rpcCall("ctx-1", "foo", {})).rejects.toThrow(/InternalError/);
  });
});

// ── adminGet ──────────────────────────────────────────────────────────────────

describe("adminGet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GETs from <nodeUrl>/admin-api/<path>", async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    await adminGet("/namespaces");
    expect(mockGet.mock.calls[0][0]).toBe("http://localhost:2430/admin-api/namespaces");
  });

  it("includes Authorization header", async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    await adminGet("/namespaces");
    const config = mockGet.mock.calls[0][1] as { headers: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer test-token");
  });

  it("returns .data.data when present", async () => {
    mockGet.mockResolvedValue({ data: { data: [{ id: "ns-1" }] } });
    const result = await adminGet<{ id: string }[]>("/namespaces");
    expect(result).toEqual([{ id: "ns-1" }]);
  });

  it("falls back to full response data when no .data.data", async () => {
    mockGet.mockResolvedValue({ data: { namespaces: [] } });
    const result = await adminGet<{ namespaces: unknown[] }>("/namespaces");
    expect(result).toEqual({ namespaces: [] });
  });
});

// ── listNamespaces ────────────────────────────────────────────────────────────

describe("listNamespaces", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the application-scoped endpoint when an applicationId is given", async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    await listNamespaces("app-123");
    expect(mockGet.mock.calls[0][0]).toBe(
      "http://localhost:2430/admin-api/namespaces/for-application/app-123",
    );
  });

  it("uses the unscoped endpoint when no applicationId is given", async () => {
    mockGet.mockResolvedValue({ data: { data: [] } });
    await listNamespaces();
    expect(mockGet.mock.calls[0][0]).toBe("http://localhost:2430/admin-api/namespaces");
  });

  it("falls back to the unscoped endpoint on 404", async () => {
    const err = { response: { status: 404 } };
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    mockGet
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ data: { data: [{ id: "ns-1" }] } });
    const result = await listNamespaces<{ id: string }[]>("app-123");
    expect(mockGet.mock.calls[0][0]).toBe(
      "http://localhost:2430/admin-api/namespaces/for-application/app-123",
    );
    expect(mockGet.mock.calls[1][0]).toBe("http://localhost:2430/admin-api/namespaces");
    expect(result).toEqual([{ id: "ns-1" }]);
  });

  it("falls back to the unscoped endpoint on 405", async () => {
    const err = { response: { status: 405 } };
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    mockGet
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ data: { data: [] } });
    await listNamespaces("app-123");
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-404/405 errors instead of falling back", async () => {
    const err = { response: { status: 500 } };
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    mockGet.mockRejectedValueOnce(err);
    await expect(listNamespaces("app-123")).rejects.toBe(err);
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});

// ── adminPost ─────────────────────────────────────────────────────────────────

describe("adminPost", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POSTs to <nodeUrl>/admin-api/<path>", async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    await adminPost("/namespaces", { alias: "my-team" });
    expect(mockPost.mock.calls[0][0]).toBe("http://localhost:2430/admin-api/namespaces");
  });

  it("sends the request body", async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    const body = { alias: "test" };
    await adminPost("/namespaces", body);
    expect(mockPost.mock.calls[0][1]).toEqual(body);
  });

  it("includes Authorization header", async () => {
    mockPost.mockResolvedValue({ data: { data: {} } });
    await adminPost("/namespaces", {});
    const config = mockPost.mock.calls[0][2] as { headers: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer test-token");
  });

  it("returns .data.data when present", async () => {
    mockPost.mockResolvedValue({ data: { data: { namespaceId: "ns-new" } } });
    const result = await adminPost<{ namespaceId: string }>("/namespaces", {});
    expect(result).toEqual({ namespaceId: "ns-new" });
  });
});

// ── adminDelete ───────────────────────────────────────────────────────────────

describe("adminDelete", () => {
  beforeEach(() => vi.clearAllMocks());

  it("DELETEs from <nodeUrl>/admin-api/<path>", async () => {
    mockDelete.mockResolvedValue({ data: { data: null } });
    await adminDelete("/namespaces/ns-1");
    expect(mockDelete.mock.calls[0][0]).toBe("http://localhost:2430/admin-api/namespaces/ns-1");
  });

  it("includes Content-Type: application/json header", async () => {
    mockDelete.mockResolvedValue({ data: { data: null } });
    await adminDelete("/namespaces/ns-1");
    const config = mockDelete.mock.calls[0][1] as { headers: Record<string, string> };
    expect(config.headers["Content-Type"]).toBe("application/json");
  });

  it("sends empty object as data body (required by some servers)", async () => {
    mockDelete.mockResolvedValue({ data: { data: null } });
    await adminDelete("/namespaces/ns-1");
    const config = mockDelete.mock.calls[0][1] as { data: unknown };
    expect(config.data).toEqual({});
  });

  it("includes Authorization header", async () => {
    mockDelete.mockResolvedValue({ data: { data: null } });
    await adminDelete("/namespaces/ns-1");
    const config = mockDelete.mock.calls[0][1] as { headers: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer test-token");
  });
});

// ── adminPut ──────────────────────────────────────────────────────────────────

describe("adminPut", () => {
  beforeEach(() => vi.clearAllMocks());

  it("PUTs to <nodeUrl>/admin-api/<path>", async () => {
    mockPut.mockResolvedValue({ data: { data: {} } });
    await adminPut("/namespaces/ns-1", { alias: "renamed" });
    expect(mockPut.mock.calls[0][0]).toBe("http://localhost:2430/admin-api/namespaces/ns-1");
  });

  it("sends the request body", async () => {
    mockPut.mockResolvedValue({ data: { data: {} } });
    const body = { alias: "renamed" };
    await adminPut("/namespaces/ns-1", body);
    expect(mockPut.mock.calls[0][1]).toEqual(body);
  });

  it("includes Authorization header", async () => {
    mockPut.mockResolvedValue({ data: { data: {} } });
    await adminPut("/namespaces/ns-1", {});
    const config = mockPut.mock.calls[0][2] as { headers: Record<string, string> };
    expect(config.headers.Authorization).toBe("Bearer test-token");
  });
});
