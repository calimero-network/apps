// `useApi()` on a delegated (account) session.
//
// The raw client's admin (`useMero().mero.admin`) is the relay's node route
// under the account's bearer token — a 403 for every call the app makes, and
// what the old axios layer amounted to. Everything must go through the
// session-aware `useMero().admin` (the account admin), contract calls through
// `mero.rpc`, and blobs must always name the context. The raw admin is spied
// on only to prove it is never reached.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { clearApplicationIdCache, useApi } from "./useApi";

const stub = vi.hoisted(() => {
  const admin = {
    listApplications: vi.fn(),
    listNamespacesForApplication: vi.fn(async () => [{ namespaceId: "ns-1", name: "Acme" }]),
    listNamespaces: vi.fn(async () => []),
    getNodeIdentity: vi.fn(async () => ({ accountId: "a".repeat(64), deviceId: null, publicKey: "" })),
    uploadBlob: vi.fn(async () => ({ blobId: "blob-1", size: 3 })),
    getBlob: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
  };
  const rawAdmin = {
    listApplications: vi.fn(),
    listNamespacesForApplication: vi.fn(),
    listNamespaces: vi.fn(),
    getNodeIdentity: vi.fn(),
    uploadBlob: vi.fn(),
    getBlob: vi.fn(),
  };
  const rpc = { execute: vi.fn() };
  return {
    admin,
    rawAdmin,
    rpc,
    setApplicationId: vi.fn(),
    mero: {
      mero: { admin: rawAdmin, rpc },
      admin,
      isDelegated: true,
      applicationId: "app-from-registry",
      nodeUrl: "https://relay.example",
    },
  };
});

vi.mock("@calimero-network/mero-react", () => ({
  useMero: () => stub.mero,
  setApplicationId: stub.setApplicationId,
}));

vi.mock("../utils/blobCache", () => ({
  getCachedBlob: async () => null,
  setCachedBlob: async () => {},
}));

beforeEach(() => clearApplicationIdCache());
afterEach(() => vi.clearAllMocks());

describe("useApi on a delegated session", () => {
  it("takes the provider's registry-resolved application id and never lists the node's apps", async () => {
    const { result } = renderHook(() => useApi());
    await expect(result.current.ensureAppId()).resolves.toBe("app-from-registry");
    expect(stub.admin.listApplications).not.toHaveBeenCalled();
    expect(stub.rawAdmin.listApplications).not.toHaveBeenCalled();
  });

  it("lists the app's namespaces through the account admin", async () => {
    const { result } = renderHook(() => useApi());
    const items = await result.current.listNamespaces("app-from-registry");
    expect(items).toEqual([{ namespaceId: "ns-1", name: "Acme" }]);
    expect(stub.admin.listNamespacesForApplication).toHaveBeenCalledWith("app-from-registry");
    expect(stub.rawAdmin.listNamespacesForApplication).not.toHaveBeenCalled();
  });

  it("answers 'who am I' with the account, from the account admin", async () => {
    const { result } = renderHook(() => useApi());
    await expect(result.current.getNodeIdentity()).resolves.toMatchObject({ accountId: "a".repeat(64) });
    expect(stub.rawAdmin.getNodeIdentity).not.toHaveBeenCalled();
  });

  it("uploads and reads blobs through the account admin, always naming the context", async () => {
    const { result } = renderHook(() => useApi());
    const bytes = new Uint8Array([9, 9, 9]);
    await expect(result.current.uploadBlob(bytes, "ctx-1")).resolves.toEqual({ blobId: "blob-1" });
    expect(stub.admin.uploadBlob).toHaveBeenCalledWith({ data: bytes, contextId: "ctx-1" });

    const buf = await result.current.getBlob("blob-1", "ctx-1");
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
    expect(stub.admin.getBlob).toHaveBeenCalledWith("blob-1", { contextId: "ctx-1" });

    expect(stub.rawAdmin.uploadBlob).not.toHaveBeenCalled();
    expect(stub.rawAdmin.getBlob).not.toHaveBeenCalled();
  });

  it("executes contract calls over the session's transport and decodes the output", async () => {
    const doc = { name: "Poster", width: 800, height: 600 };
    stub.rpc.execute.mockResolvedValueOnce(Array.from(new TextEncoder().encode(JSON.stringify(doc))));
    const { result } = renderHook(() => useApi());
    await expect(result.current.call("ctx-1", "get_document", {})).resolves.toEqual(doc);
    expect(stub.rpc.execute).toHaveBeenCalledWith({ contextId: "ctx-1", method: "get_document", argsJson: {} });
  });

  it("decodes a contract abort into its words", async () => {
    stub.rpc.execute.mockRejectedValueOnce(
      new Error("the method call returned an error: [34, 110, 111, 112, 101, 34]"),
    );
    const { result } = renderHook(() => useApi());
    await expect(result.current.call("ctx-1", "grant_editor", { member: "x" })).rejects.toThrow(/^nope$/);
  });

  it("keeps the runtime's 'method not found' message intact for the compat fallbacks", async () => {
    stub.rpc.execute.mockRejectedValueOnce(new Error('method "move_layers" not found'));
    const { result } = renderHook(() => useApi());
    await expect(result.current.call("ctx-1", "move_layers", {})).rejects.toThrow(/method "move_layers" not found/);
  });
});
