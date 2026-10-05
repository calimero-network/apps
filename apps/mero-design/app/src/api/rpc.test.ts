import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { RpcError } from "@calimero-network/mero-js";
import { bindApi, getApi, type ApiBinding } from "./client";
import {
  createContext,
  createNamespace,
  createNamespaceInvitation,
  createSubgroup,
  decodeOutput,
  getBlob,
  getContextIdentitiesOwned,
  getNodeIdentity,
  joinContext,
  joinNamespace,
  listGroupContexts,
  listGroupMembers,
  listNamespaces,
  listSubgroups,
  rpcCall,
  updateMemberRole,
  uploadBlob,
} from "./rpc";

vi.mock("../utils/blobCache", () => ({
  getCachedBlob: vi.fn().mockResolvedValue(null),
  setCachedBlob: vi.fn(),
}));

// The data layer talks to whatever `ApiBinder` bound: the session's rpc
// transport and admin client. Tests bind fakes and read what reached them.
const execute = vi.fn();
const admin = {
  getNodeIdentity: vi.fn(),
  listNamespaces: vi.fn(),
  listNamespacesForApplication: vi.fn(),
  createNamespace: vi.fn(),
  deleteNamespace: vi.fn(),
  createNamespaceInvitation: vi.fn(),
  joinNamespace: vi.fn(),
  listSubgroups: vi.fn(),
  listGroupContexts: vi.fn(),
  createGroupInNamespace: vi.fn(),
  setSubgroupVisibility: vi.fn(),
  createContext: vi.fn(),
  deleteContext: vi.fn(),
  joinContext: vi.fn(),
  getContextIdentitiesOwned: vi.fn(),
  listGroupMembers: vi.fn(),
  updateMemberRole: vi.fn(),
  uploadBlob: vi.fn(),
  getBlob: vi.fn(),
};

function bind(isDelegated = false) {
  bindApi({
    rpc: { execute } as unknown as ApiBinding["rpc"],
    admin: admin as unknown as ApiBinding["admin"],
    events: null,
    isDelegated,
  });
}

/** What a node's `execute` hands mero-js: JSON-encoded output bytes. */
function bytesOf(value: unknown): number[] {
  return Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

beforeEach(() => {
  vi.clearAllMocks();
  bind();
  execute.mockResolvedValue([]);
});
afterEach(() => bindApi(null));

// ── binding ───────────────────────────────────────────────────────────────────

describe("the binding", () => {
  it("fails loudly when nothing is connected", () => {
    bindApi(null);
    expect(() => getApi()).toThrow(/Not connected/);
  });

  it("a contract call before a session is bound rejects, rather than hitting a node", async () => {
    bindApi(null);
    await expect(rpcCall("ctx-1", "get_elements", {})).rejects.toThrow(/Not connected/);
    expect(execute).not.toHaveBeenCalled();
  });
});

// ── rpcCall ───────────────────────────────────────────────────────────────────

describe("rpcCall — request shape", () => {
  it("executes on the session transport with contextId / method / argsJson", async () => {
    await rpcCall("ctx-1", "get_elements", {});
    expect(execute).toHaveBeenCalledWith({ contextId: "ctx-1", method: "get_elements", argsJson: {} });
  });

  it("passes args object directly as argsJson (not a JSON string)", async () => {
    await rpcCall("ctx-1", "update_element", { id: "e1", x: 10 });
    const params = execute.mock.calls[0][0] as { argsJson: unknown };
    expect(params.argsJson).toEqual({ id: "e1", x: 10 });
  });

  it("add_element sends lowercase kind", async () => {
    await rpcCall("ctx-1", "add_element", {
      element: {
        id: "e1", data: { kind: "rect" }, x: 0, y: 0, width: 1, height: 1, rotation: 0,
        fill: "#fff", stroke: "#000", strokeWidth: 1, opacity: 100, layerIndex: 0,
        createdBy: "", createdAt: 0, updatedAt: 0,
      },
    });
    const params = execute.mock.calls[0][0] as { argsJson: { element: { data: { kind: string } } } };
    expect(params.argsJson.element.data.kind).toBe("rect");
  });
});

describe("rpcCall — response parsing", () => {
  it("decodes legacy output bytes as JSON", async () => {
    execute.mockResolvedValue(bytesOf([{ id: "e1" }]));
    expect(await rpcCall("ctx-1", "get_comments", {})).toEqual([{ id: "e1" }]);
  });

  it("decodes a single object from output bytes", async () => {
    execute.mockResolvedValue(bytesOf({ name: "Board" }));
    expect(await rpcCall("ctx-1", "get_board", {})).toEqual({ name: "Board" });
  });

  it("passes an already-parsed array of objects through", async () => {
    execute.mockResolvedValue([{ id: "e1" }, { id: "e2" }]);
    expect(await rpcCall("ctx-1", "get_comments", {})).toEqual([{ id: "e1" }, { id: "e2" }]);
  });

  it("parses a JSON string output, and keeps a plain string", async () => {
    execute.mockResolvedValue('"admin"');
    expect(await rpcCall("ctx-1", "my_role", {})).toBe("admin");
    execute.mockResolvedValue("viewer");
    expect(await rpcCall("ctx-1", "my_role", {})).toBe("viewer");
  });

  it("returns null for an empty output array", async () => {
    execute.mockResolvedValue([]);
    expect(await rpcCall("ctx-1", "get_elements", {})).toBeNull();
  });

  it("decodes boolean true from output bytes", async () => {
    execute.mockResolvedValue(bytesOf(true));
    expect(await rpcCall("ctx-1", "is_member", {})).toBe(true);
  });

  it("decodes null from output bytes", async () => {
    execute.mockResolvedValue(bytesOf(null));
    expect(await rpcCall("ctx-1", "get_element", {})).toBeNull();
  });

  it("decodeOutput keeps a bare boolean or number", () => {
    expect(decodeOutput(false)).toBe(false);
    expect(decodeOutput(3)).toBe(3);
  });
});

describe("rpcCall — error handling", () => {
  it("throws the WASM reason when the RPC error carries one as data", async () => {
    execute.mockRejectedValue(new RpcError(-32000, "execution failed", "not an editor"));
    await expect(rpcCall("ctx-1", "add_element", {})).rejects.toThrow("not an editor");
  });

  it("throws a nested data message", async () => {
    execute.mockRejectedValue(new RpcError(-32000, "execution failed", { data: "no such element" }));
    await expect(rpcCall("ctx-1", "delete_element", {})).rejects.toThrow("no such element");
  });

  it("falls back to the RPC-level message", async () => {
    execute.mockRejectedValue(new RpcError(-32601, "method not found"));
    await expect(rpcCall("ctx-1", "nope", {})).rejects.toThrow("method not found");
  });

  it("passes any other error through", async () => {
    execute.mockRejectedValue(new Error("network down"));
    await expect(rpcCall("ctx-1", "get_elements", {})).rejects.toThrow("network down");
  });
});

// ── admin wrappers ───────────────────────────────────────────────────────────

describe("getNodeIdentity", () => {
  it("asks the session's admin and returns the account", async () => {
    admin.getNodeIdentity.mockResolvedValue({ accountId: "acc", deviceId: null, publicKey: "pk" });
    expect(await getNodeIdentity()).toEqual({ accountId: "acc", deviceId: null, publicKey: "pk" });
  });
});

describe("listNamespaces", () => {
  it("uses the application-scoped listing when an applicationId is given", async () => {
    admin.listNamespacesForApplication.mockResolvedValue([{ namespaceId: "ns1", name: "Design" }]);
    expect(await listNamespaces("app-1")).toEqual([{ namespaceId: "ns1", name: "Design" }]);
    expect(admin.listNamespacesForApplication).toHaveBeenCalledWith("app-1");
    expect(admin.listNamespaces).not.toHaveBeenCalled();
  });

  it("uses the unscoped listing when no applicationId is given", async () => {
    admin.listNamespaces.mockResolvedValue([{ namespaceId: "ns1" }]);
    expect(await listNamespaces()).toEqual([{ namespaceId: "ns1", name: undefined }]);
    expect(admin.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it.each([404, 405])("falls back to the unscoped listing on %i", async (status) => {
    admin.listNamespacesForApplication.mockRejectedValue(Object.assign(new Error("nope"), { status }));
    admin.listNamespaces.mockResolvedValue([{ namespaceId: "ns1" }]);
    expect(await listNamespaces("app-1")).toEqual([{ namespaceId: "ns1", name: undefined }]);
  });

  it("rethrows other errors instead of falling back", async () => {
    admin.listNamespacesForApplication.mockRejectedValue(Object.assign(new Error("forbidden"), { status: 403 }));
    await expect(listNamespaces("app-1")).rejects.toThrow("forbidden");
    expect(admin.listNamespaces).not.toHaveBeenCalled();
  });

  it("reads the { namespaces } and { data } envelopes and the alias spelling", async () => {
    admin.listNamespaces.mockResolvedValue({ namespaces: [{ id: "ns1", alias: "Old" }] });
    expect(await listNamespaces()).toEqual([{ namespaceId: "ns1", name: "Old" }]);
    admin.listNamespaces.mockResolvedValue({ data: [{ groupId: "ns2" }] });
    expect(await listNamespaces()).toEqual([{ namespaceId: "ns2", name: undefined }]);
  });
});

describe("createNamespace", () => {
  it("sends exactly applicationId + name", async () => {
    admin.createNamespace.mockResolvedValue({ namespaceId: "ns1" });
    expect(await createNamespace("app-1", "Design")).toEqual({ namespaceId: "ns1" });
    expect(admin.createNamespace).toHaveBeenCalledWith({ applicationId: "app-1", name: "Design" });
  });

  it("surfaces the account admin's HA outcome", async () => {
    admin.createNamespace.mockResolvedValue({ namespaceId: "ns1", haEnabled: false, haError: "not linked" });
    expect(await createNamespace("app-1", "Design")).toEqual({
      namespaceId: "ns1", haEnabled: false, haError: "not linked",
    });
  });
});

describe("invitations", () => {
  it("createNamespaceInvitation returns the signed response verbatim", async () => {
    const signed = { invitation: { invitation: { group_id: [1] }, inviterSignature: "s" } };
    admin.createNamespaceInvitation.mockResolvedValue(signed);
    expect(await createNamespaceInvitation("ns1")).toBe(signed);
    expect(admin.createNamespaceInvitation).toHaveBeenCalledWith("ns1");
  });

  it("joinNamespace wraps the invitation struct as the body", async () => {
    admin.joinNamespace.mockResolvedValue({ namespaceId: "ns1" });
    await joinNamespace("ns1", { group_id: [1] });
    expect(admin.joinNamespace).toHaveBeenCalledWith("ns1", { invitation: { group_id: [1] } });
  });
});

describe("projects", () => {
  it("listSubgroups and listGroupContexts normalise every envelope the routes have used", async () => {
    admin.listSubgroups.mockResolvedValue([{ groupId: "g1", name: "A" }]);
    expect(await listSubgroups("ns1")).toEqual([{ groupId: "g1", name: "A" }]);
    admin.listSubgroups.mockResolvedValue({ subgroups: [{ group_id: "g2" }] });
    expect(await listSubgroups("ns1")).toEqual([{ groupId: "g2", name: undefined }]);
    admin.listGroupContexts.mockResolvedValue([{ contextId: "c1" }]);
    expect(await listGroupContexts("g1")).toEqual([{ contextId: "c1", name: undefined }]);
    admin.listGroupContexts.mockResolvedValue({ contexts: [{ context_id: "c2", alias: "Board" }] });
    expect(await listGroupContexts("g1")).toEqual([{ contextId: "c2", name: "Board" }]);
  });

  it("createSubgroup sends only groupName", async () => {
    admin.createGroupInNamespace.mockResolvedValue({ groupId: "g1" });
    expect(await createSubgroup("ns1", "Landing")).toBe("g1");
    expect(admin.createGroupInNamespace).toHaveBeenCalledWith("ns1", { groupName: "Landing" });
  });

  it("createContext sends the request as given and returns the id", async () => {
    admin.createContext.mockResolvedValue({ contextId: "c1", memberPublicKey: "" });
    const req = { applicationId: "app-1", groupId: "g1", name: "Landing", initializationParams: [1, 2] };
    expect(await createContext(req)).toBe("c1");
    expect(admin.createContext).toHaveBeenCalledWith(req);
  });

  it("joinContext and getContextIdentitiesOwned read the session's answers", async () => {
    admin.joinContext.mockResolvedValue({ contextId: "c1", memberPublicKey: "me" });
    expect(await joinContext("c1")).toEqual({ memberPublicKey: "me" });
    admin.getContextIdentitiesOwned.mockResolvedValue({ identities: ["me"] });
    expect(await getContextIdentitiesOwned("c1")).toEqual(["me"]);
    admin.getContextIdentitiesOwned.mockResolvedValue(["a", "b"]);
    expect(await getContextIdentitiesOwned("c1")).toEqual(["a", "b"]);
  });
});

describe("members", () => {
  it("listGroupMembers normalises identity / role / name", async () => {
    admin.listGroupMembers.mockResolvedValue({
      members: [{ identity: "a", role: "Admin", name: " Ana " }, { memberId: "b", role: "Member" }, { id: "" }],
    });
    expect(await listGroupMembers("ns1")).toEqual([
      { identity: "a", role: "Admin", name: "Ana" },
      { identity: "b", role: "Member", name: undefined },
    ]);
  });

  it("updateMemberRole sends { role }", async () => {
    admin.updateMemberRole.mockResolvedValue(undefined);
    await updateMemberRole("ns1", "a", "Admin");
    expect(admin.updateMemberRole).toHaveBeenCalledWith("ns1", "a", { role: "Admin" });
  });
});

// ── blobs ─────────────────────────────────────────────────────────────────────

describe("blobs always carry the context", () => {
  it("uploadBlob passes contextId and returns the blob id", async () => {
    admin.uploadBlob.mockResolvedValue({ blobId: "b1", size: 3 });
    const data = new Uint8Array([1, 2, 3]).buffer;
    expect(await uploadBlob(data, "ctx-1")).toEqual({ blobId: "b1" });
    expect(admin.uploadBlob).toHaveBeenCalledWith({ data, contextId: "ctx-1" });
  });

  it("uploadBlob refuses an empty contextId before calling anything", async () => {
    await expect(uploadBlob(new ArrayBuffer(1), "")).rejects.toThrow(/context id/);
    expect(admin.uploadBlob).not.toHaveBeenCalled();
  });

  it("getBlob passes contextId", async () => {
    const buf = new Uint8Array([9]).buffer;
    admin.getBlob.mockResolvedValue(buf);
    expect(await getBlob("b1", "ctx-1")).toBe(buf);
    expect(admin.getBlob).toHaveBeenCalledWith("b1", { contextId: "ctx-1" });
  });

  it("getBlob refuses an empty contextId", async () => {
    await expect(getBlob("b1", "")).rejects.toThrow(/context id/);
    expect(admin.getBlob).not.toHaveBeenCalled();
  });
});
