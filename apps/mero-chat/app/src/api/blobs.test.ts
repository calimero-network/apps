/**
 * The blob contract, asserted.
 *
 * These are unit tests over `api/blobs.ts` with the SDK stubbed, so they run in
 * Frontend CI with no node. They cover the two defects this app's lineage has
 * actually shipped — a base58 blob id written where the node wanted hex, and an
 * upload with an empty-string context that reached nobody — plus the shape of
 * every call, so a future SDK rename cannot pass silently.
 *
 * What they deliberately do NOT cover is bytes crossing a node: no stub can
 * tell you whether discovery works. That is `e2e/blobs.spec.ts`, which runs two
 * real merod nodes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// `Blob.arrayBuffer()` is missing from the jsdom the workspace catalog pins
// (25.x), so read through FileReader, which every jsdom has. Browsers have both.
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

const admin = {
  uploadBlob: vi.fn(),
  getBlob: vi.fn(),
  getBlobInfo: vi.fn(),
  deleteBlob: vi.fn(),
};

vi.mock("./meroJsClient", () => ({
  getMeroJs: () => ({ admin }),
}));

vi.mock("@calimero-network/mero-react", () => ({
  getNodeUrl: () => "http://localhost:2528",
}));

import {
  BLOB_READ_TIMEOUT_MS,
  BlobContextRequiredError,
  blobInfo,
  blobUrl,
  deleteBlob,
  downloadBlob,
  isNotFound,
  isUsableBlobId,
  toBlobIdHex,
  uploadBlob,
} from "./blobs";

// 32 bytes, so it is a legal blob id in every encoding below.
const BYTES = Array.from({ length: 32 }, (_, i) => i + 1);
const HEX = BYTES.map((b) => b.toString(16).padStart(2, "0")).join("");
// The same 32 bytes, base58 — what rows written before core 0.11.0-rc.27 hold.
const BASE58 = "4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw";

const CTX = "c".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("toBlobIdHex", () => {
  it("passes hex through, lowercased", () => {
    expect(toBlobIdHex(HEX)).toBe(HEX);
    expect(toBlobIdHex(HEX.toUpperCase())).toBe(HEX);
  });

  it("strips an 0x prefix", () => {
    expect(toBlobIdHex(`0x${HEX}`)).toBe(HEX);
  });

  it("trims surrounding whitespace, which a paste carries", () => {
    expect(toBlobIdHex(`  ${HEX}\n`)).toBe(HEX);
  });

  it("converts the byte array the ABI hands back for a BlobId field", () => {
    expect(toBlobIdHex(BYTES)).toBe(HEX);
    expect(toBlobIdHex(new Uint8Array(BYTES))).toBe(HEX);
  });

  // ── The defect this helper exists for ──────────────────────────────────────
  //
  // Three call sites in this lineage ran `bs58.encode` before writing a blob id
  // to the contract. core 0.11.0-rc.27 took base58 off the wire, so the node
  // then refused to decode what it had just been given:
  //
  //   Failed to decode blob ID (expected hex) 'EV2Hz…': Odd number of digits
  //
  // It read as three unrelated bugs — the upload "worked", the contract held a
  // string, and only the reader 404'd — which is why the decode is kept for
  // READING and nothing in this app may produce one.
  it("decodes a legacy base58 id so pre-rc.27 rows still resolve", () => {
    expect(toBlobIdHex(BASE58)).toBe(HEX);
  });

  it("returns the hex form, never the base58 one it was handed", () => {
    // The point of the helper: whatever went in, what comes out is what the
    // node parses. Asserting inequality as well as equality, because a
    // pass-through implementation would satisfy the line above for a hex input
    // and quietly break this one.
    expect(toBlobIdHex(BASE58)).not.toBe(BASE58);
    expect(toBlobIdHex(BASE58)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns an empty string — never throws — for anything unusable", () => {
    expect(toBlobIdHex("")).toBe("");
    expect(toBlobIdHex("   ")).toBe("");
    expect(toBlobIdHex("not-a-blob-id!!!")).toBe("");
    expect(toBlobIdHex("abc123")).toBe(""); // valid hex, wrong length
    expect(toBlobIdHex(HEX.slice(0, 62))).toBe("");
    expect(toBlobIdHex([1, 2, 3])).toBe(""); // valid bytes, wrong length
    expect(toBlobIdHex(BYTES.concat([33]))).toBe("");
  });

  it("rejects a base58 string that decodes to the wrong length", () => {
    // Valid base58, four bytes. The alphabet check alone would accept it.
    expect(toBlobIdHex("2VfUX")).toBe("");
  });
});

describe("isUsableBlobId", () => {
  it("is true only for something the node could fetch", () => {
    expect(isUsableBlobId(HEX)).toBe(true);
    expect(isUsableBlobId(BASE58)).toBe(true);
    expect(isUsableBlobId(BYTES)).toBe(true);
    expect(isUsableBlobId("")).toBe(false);
    expect(isUsableBlobId("nope")).toBe(false);
  });
});

describe("uploadBlob", () => {
  it("announces to the context, so peers can discover the bytes", async () => {
    admin.uploadBlob.mockResolvedValue({ blobId: HEX, size: 7 });
    const data = new Uint8Array([1, 2, 3]);

    const res = await uploadBlob(data, CTX);

    // The exact request shape. `contextId` becomes the `context_id` query
    // param, which is the ONLY thing that makes the blob findable off this
    // node since rc.39.
    expect(admin.uploadBlob).toHaveBeenCalledWith({ data, contextId: CTX });
    expect(res).toEqual({ blobId: HEX, size: 7 });
  });

  // ── The other shipped defect ───────────────────────────────────────────────
  //
  // `uploadBlob({ contextId: '' })` does not error: mero-js tests
  // `if (options.contextId)`, so an empty string degrades to a LOCAL upload.
  // The bytes are stored, the call resolves, a blob id comes back, and the file
  // is readable by exactly one person — the uploader, whose own node holds it.
  // There is no later point at which that is detectable.
  const noContext: Array<[string, string | undefined]> = [
    ["an empty string", ""],
    ["whitespace", "   "],
    ["an absent value", undefined],
  ];
  it.each(noContext)(
    "refuses %s as a context rather than uploading somewhere nobody can read",
    async (_label, contextId) => {
      await expect(
        uploadBlob(new Uint8Array([1]), contextId as unknown as string),
      ).rejects.toBeInstanceOf(BlobContextRequiredError);
      expect(admin.uploadBlob).not.toHaveBeenCalled();
    },
  );

  it("canonicalises the returned id to hex", async () => {
    // A node that answered base58 (or a shim that re-encoded on the way out)
    // must not put a base58 string into the contract.
    admin.uploadBlob.mockResolvedValue({ blobId: BASE58, size: 1 });
    expect((await uploadBlob(new Uint8Array([1]), CTX)).blobId).toBe(HEX);
  });

  it("fails loudly when the node returns no usable id", async () => {
    admin.uploadBlob.mockResolvedValue({ blobId: "", size: 0 });
    await expect(uploadBlob(new Uint8Array([1]), CTX)).rejects.toThrow(
      /blob id this app cannot use/,
    );
  });
});

describe("downloadBlob", () => {
  it("reads through the context, and returns the bytes it was given", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    admin.getBlob.mockResolvedValue(bytes.buffer);

    const blob = await downloadBlob(HEX, CTX);

    // Second argument is an options OBJECT — `getBlob(id, contextId)` would
    // type-check as `getBlob(id, undefined)` in JS and silently do a
    // local-only read.
    expect(admin.getBlob).toHaveBeenCalledWith(HEX, { contextId: CTX });
    expect(blob).toBeInstanceOf(Blob);
    expect(await bytesOf(blob)).toEqual(bytes);
  });

  it("converts a legacy base58 id before asking the node", async () => {
    admin.getBlob.mockResolvedValue(new Uint8Array([1]).buffer);
    await downloadBlob(BASE58, CTX);
    expect(admin.getBlob).toHaveBeenCalledWith(HEX, { contextId: CTX });
  });

  it("refuses to read without a context, which would be a local-only lookup", async () => {
    await expect(downloadBlob(HEX, "")).rejects.toBeInstanceOf(
      BlobContextRequiredError,
    );
    expect(admin.getBlob).not.toHaveBeenCalled();
  });

  it("refuses an unusable id instead of 404ing against the node", async () => {
    await expect(downloadBlob("nope", CTX)).rejects.toThrow(/usable blob id/);
    expect(admin.getBlob).not.toHaveBeenCalled();
  });
});

describe("blobInfo", () => {
  it("reports presence without transferring bytes", async () => {
    admin.getBlobInfo.mockResolvedValue({
      blobId: HEX,
      size: 42,
      source: "peer",
    });

    const res = await blobInfo(HEX, CTX);

    expect(admin.getBlobInfo).toHaveBeenCalledWith(HEX, { contextId: CTX });
    expect(res.found).toBe(true);
    expect(res.info?.size).toBe(42);
  });

  it("treats a peer-sourced answer with no mimeType as valid, not malformed", async () => {
    // A probe carries presence and size only. Reading a missing `mimeType` as
    // a bad response would reject every blob that lives on another node —
    // i.e. exactly the ones discovery is for.
    admin.getBlobInfo.mockResolvedValue({
      blobId: HEX,
      size: 42,
      source: "peer",
    });
    const res = await blobInfo(HEX, CTX);
    expect(res.found).toBe(true);
    expect(res.info?.mimeType).toBeUndefined();
  });

  it("maps the node's 404 to found:false", async () => {
    admin.getBlobInfo.mockRejectedValue(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );
    expect(await blobInfo(HEX, CTX)).toEqual({ found: false, info: null });
  });

  it("rethrows a transport failure rather than calling it a miss", async () => {
    // "nobody holds this" and "the node is unreachable" need different UI, and
    // swallowing the second as the first is how a broken node reads as an
    // empty conversation.
    admin.getBlobInfo.mockRejectedValue(new Error("network down"));
    await expect(blobInfo(HEX, CTX)).rejects.toThrow("network down");
  });
});

describe("deleteBlob", () => {
  it("canonicalises to hex first", async () => {
    admin.deleteBlob.mockResolvedValue({ blobId: HEX, deleted: true });
    await deleteBlob(BASE58);
    expect(admin.deleteBlob).toHaveBeenCalledWith(HEX);
  });

  it("is a no-op for an id that could not name a blob", async () => {
    await deleteBlob("");
    expect(admin.deleteBlob).not.toHaveBeenCalled();
  });
});

describe("blobUrl", () => {
  it("spells the query param snake_case, as the wire does", () => {
    const url = new URL(blobUrl(HEX, CTX));
    expect(url.pathname).toBe(`/admin-api/blobs/${HEX}`);
    // `contextId` is the SDK's spelling; the server only reads `context_id`.
    expect(url.searchParams.get("context_id")).toBe(CTX);
    expect(url.searchParams.get("contextId")).toBeNull();
  });
});

describe("isNotFound", () => {
  it("recognises a 404 however the transport surfaced it", () => {
    expect(isNotFound(Object.assign(new Error("x"), { status: 404 }))).toBe(
      true,
    );
    expect(isNotFound(new Error("Request failed with status 404"))).toBe(true);
    expect(isNotFound(new Error("Blob not found locally or in network"))).toBe(
      true,
    );
    expect(isNotFound(new Error("Internal Server Error"))).toBe(false);
    expect(isNotFound(Object.assign(new Error("x"), { status: 500 }))).toBe(
      false,
    );
  });
});

describe("BLOB_READ_TIMEOUT_MS", () => {
  // Stated as a property because the number is the whole point: core's
  // discovery sweep runs to a ~30s deadline BEFORE any transfer starts, so a
  // budget at or under 30s aborts a read that was about to succeed — and only
  // in the case discovery exists for, a blob held by a peer. A "tidy-up" back
  // to 30_000 would reintroduce that silently.
  it("leaves room beyond core's ~30s discovery deadline", () => {
    expect(BLOB_READ_TIMEOUT_MS).toBeGreaterThan(30_000);
  });
});
