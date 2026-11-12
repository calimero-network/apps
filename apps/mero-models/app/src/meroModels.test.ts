import { describe, expect, it, vi } from "vitest";

import { MeroModelsClient } from "./generated/client";
import { u64 } from "./meroModels";
import { clientTransport, tooLarge } from "./editor/blobs";
import { MAX_BLOB_BYTES, makeObject } from "./editor/model";
import { withRoutes } from "@calimero-apps/connect/testing";

describe("the generated MeroModelsClient", () => {
  it("routes calls through the log and views to a node, `now` as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: ["a"], events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: [] });
    const after = vi.fn();
    const c = new MeroModelsClient(withRoutes({ call, view }), "app-1", { after });
    const cube = { ...makeObject("cube", []), id: "a" };

    expect(await c.putObjects({ objects: [cube], now: u64(1727000000000.7) })).toEqual(["a"]);
    expect(call).toHaveBeenCalledWith("app-1", "putObjects", { objects: [cube], now: "1727000000000" });
    await c.listHistory({ assetId: "m" });
    expect(view).toHaveBeenCalledWith("app-1", "listHistory", { assetId: "m" });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const c = new MeroModelsClient(
      withRoutes({ call: vi.fn().mockRejectedValue(new Error("422 Forbidden")), view: vi.fn() }),
      "app-1",
      { after },
    );
    await expect(c.clearScene()).rejects.toThrow("Forbidden");
    expect(after).toHaveBeenCalledOnce();
  });
});

describe("blobs", () => {
  it("uploads to the scene and names the blob by its lowercase hex id", async () => {
    const uploadBlob = vi.fn().mockResolvedValue({ blobId: "base58", id: "AB".repeat(32), size: 3 });
    const downloadBlob = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const t = clientTransport(withRoutes({ uploadBlob, downloadBlob }));
    expect(await t.upload(new Uint8Array(3), "app-1")).toEqual({ blobId: "ab".repeat(32), size: 3 });
    expect(uploadBlob).toHaveBeenCalledWith("app-1", new Uint8Array(3));
    expect(new Uint8Array(await t.download("ab".repeat(32), "app-1"))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a blob larger than one sealed request carries, before uploading", async () => {
    expect(MAX_BLOB_BYTES).toBe(49_545_216);
    expect(tooLarge(MAX_BLOB_BYTES)).toBeNull();
    expect(tooLarge(MAX_BLOB_BYTES + 1)).toContain("at most 47.25 MiB");
    const uploadBlob = vi.fn();
    const t = clientTransport(withRoutes({ uploadBlob, downloadBlob: vi.fn() }));
    await expect(t.upload(new Uint8Array(MAX_BLOB_BYTES + 1), "app-1")).rejects.toThrow("47.25 MiB");
    expect(uploadBlob).not.toHaveBeenCalled();
  });
});
