import { afterEach, describe, expect, it, vi } from "vitest";

import { setActiveApp, setConnection } from "../calimero/connection";
import { blobInfo, deleteBlob, downloadBlob, isUsableBlobId, toBlobIdHex, uploadBlob } from "./blobs";

const HEX = "ab".repeat(32);

function connect(client: Record<string, unknown>) {
  const after = vi.fn();
  setConnection({
    client: client as never,
    accountId: "me",
    source: "bundle",
    passkey: () => ({}) as never,
    after,
  });
  return after;
}

afterEach(() => setConnection(null));

describe("blob ids", () => {
  it("are 64 lowercase hex digits", () => {
    expect(toBlobIdHex(HEX.toUpperCase())).toBe(HEX);
    expect(toBlobIdHex(`0x${HEX}`)).toBe(HEX);
    expect(toBlobIdHex(new Uint8Array(32).fill(0xab))).toBe(HEX);
    expect(toBlobIdHex("not-hex")).toBe("");
    expect(isUsableBlobId(HEX)).toBe(true);
    expect(isUsableBlobId("abc")).toBe(false);
  });
});

describe("blobs belong to a conversation", () => {
  it("uploads the bytes to the conversation and answers the hex id", async () => {
    const uploadBlob_ = vi.fn().mockResolvedValue({ blobId: "base58", id: HEX, size: 3 });
    const after = connect({ uploadBlob: uploadBlob_ });
    expect(await uploadBlob(new Uint8Array([1, 2, 3]), "app-1")).toEqual({ blobId: HEX, size: 3 });
    expect(uploadBlob_).toHaveBeenCalledWith("app-1", new Uint8Array([1, 2, 3]));
    expect(after).toHaveBeenCalled();
  });

  it("refuses a node answer that is not a usable id", async () => {
    connect({ uploadBlob: vi.fn().mockResolvedValue({ id: "zz", size: 1 }) });
    await expect(uploadBlob(new Uint8Array([1]), "app-1")).rejects.toThrow(/cannot use/);
  });

  it("downloads from the open conversation when none is named", async () => {
    const download = vi.fn().mockResolvedValue(new Uint8Array([7]));
    connect({ downloadBlob: download });
    setActiveApp("app-open");
    const blob = await downloadBlob(HEX, "");
    expect(download).toHaveBeenCalledWith("app-open", HEX);
    expect(blob.size).toBe(1);
  });

  it("needs a conversation", async () => {
    connect({ downloadBlob: vi.fn() });
    setActiveApp("");
    await expect(downloadBlob(HEX, "")).rejects.toThrow(/conversation/);
  });

  it("maps a 404 to found:false", async () => {
    connect({ blobInfo: vi.fn().mockRejectedValue(Object.assign(new Error("nope"), { status: 404 })) });
    expect(await blobInfo(HEX, "app-1")).toEqual({ found: false, info: null });
  });

  it("ignores a refused delete: the host expires an unreferenced blob anyway", async () => {
    const del = vi.fn().mockRejectedValue(new Error("forbidden"));
    connect({ deleteBlob: del });
    await expect(deleteBlob(HEX, "app-1")).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledWith("app-1", HEX);
  });
});
