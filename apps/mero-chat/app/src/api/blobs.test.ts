import { beforeEach, describe, expect, it, vi } from "vitest";

const h = await vi.hoisted(async () =>
  (await import("@calimero-apps/connect/testing")).withRoutes({
    uploadBlob: vi.fn(),
    downloadBlob: vi.fn(),
    deleteBlob: vi.fn(),
  }),
);

vi.mock("./calimero", () => ({
  after: () => {},
  getContextId: () => "app-open",
  getClient: () => h,
}));

import { deleteBlob, downloadBlob, isUsableBlobId, toBlobIdHex, uploadBlob } from "./blobs";

const ID = "ab".repeat(32);

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
});

describe("blob ids", () => {
  it("are 64 lowercase hex characters", () => {
    expect(toBlobIdHex(ID.toUpperCase())).toBe(ID);
    expect(toBlobIdHex(`0x${ID}`)).toBe(ID);
    expect(toBlobIdHex(new Uint8Array(32).fill(0xab))).toBe(ID);
    expect(toBlobIdHex("not-a-blob")).toBe("");
    expect(isUsableBlobId(ID)).toBe(true);
    expect(isUsableBlobId("abc")).toBe(false);
  });
});

describe("uploadBlob", () => {
  it("stores the bytes as a blob of the conversation's app and answers the hex id", async () => {
    h.uploadBlob.mockResolvedValue({ blobId: "base58", id: ID, size: 3 });
    await expect(uploadBlob(new Uint8Array([1, 2, 3]), "app-1")).resolves.toEqual({ blobId: ID, size: 3 });
    expect(h.uploadBlob).toHaveBeenCalledWith("app-1", new Uint8Array([1, 2, 3]));
  });

  it("needs the conversation", async () => {
    await expect(uploadBlob(new Uint8Array([1]), "")).rejects.toThrow(/app id/);
  });
});

describe("downloadBlob / deleteBlob", () => {
  it("reads a blob of the app as a Blob", async () => {
    h.downloadBlob.mockResolvedValue(new Uint8Array([7, 8]));
    const blob = await downloadBlob(ID, "app-1");
    expect(h.downloadBlob).toHaveBeenCalledWith("app-1", ID);
    expect(blob.size).toBe(2);
  });

  it("refuses an id that is not one", async () => {
    await expect(downloadBlob("nope", "app-1")).rejects.toThrow(/usable blob id/);
  });

  it("deletes from the open conversation when none is named", async () => {
    h.deleteBlob.mockResolvedValue(undefined);
    await deleteBlob(ID);
    expect(h.deleteBlob).toHaveBeenCalledWith("app-open", ID);
  });
});
