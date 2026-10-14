import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { BlobStore, type BlobTransport } from "./blobs";
import { shapeFromGeometry } from "./geometry";
import { MeshDecodeError, decodeMesh, encodeMesh } from "./meshcodec";

const sphere = () => shapeFromGeometry(new THREE.SphereGeometry(1, 48, 24), undefined, true);

describe("the mesh blob format", () => {
  it("round-trips positions, indices and UVs exactly", () => {
    const s = sphere();
    const back = decodeMesh(encodeMesh(s), { vertex_count: s.positions.length / 3, triangle_count: s.indices.length / 3 });
    expect(back.positions).toEqual(s.positions);
    expect(back.indices).toEqual(s.indices);
    expect(back.uvs).toEqual(s.uvs);
  });

  it("is deterministic, so an unchanged mesh is the same blob", () => {
    expect(encodeMesh(sphere())).toEqual(encodeMesh(sphere()));
  });

  it("is compressed", () => {
    const s = sphere();
    const raw = s.positions.byteLength + s.indices.byteLength + (s.uvs?.byteLength ?? 0);
    expect(encodeMesh(s).byteLength).toBeLessThan(raw);
  });

  it("refuses a blob that is not a mesh, is truncated, or disagrees with its reference", () => {
    const bytes = encodeMesh(sphere());
    expect(() => decodeMesh(new Uint8Array([1, 2, 3]))).toThrow(MeshDecodeError);
    const wrongMagic = bytes.slice();
    wrongMagic[0] = 0;
    expect(() => decodeMesh(wrongMagic)).toThrow(/magic/);
    expect(() => decodeMesh(bytes.slice(0, bytes.length - 10))).toThrow(MeshDecodeError);
    expect(() => decodeMesh(bytes, { vertex_count: 1, triangle_count: 1 })).toThrow(/reference says/);
    const newer = bytes.slice();
    newer[4] = 9;
    expect(() => decodeMesh(newer)).toThrow(/newer/);
  });

  it("refuses an index past the last vertex", () => {
    const bad = encodeMesh({ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 7]) });
    expect(() => decodeMesh(bad)).toThrow(/does not have/);
  });
});

describe("the blob store", () => {
  function transport() {
    const store = new Map<string, Uint8Array>();
    const t: BlobTransport = {
      upload: vi.fn(async (data: Uint8Array) => {
        const id = String(store.size).padStart(64, "0");
        store.set(id, data.slice());
        return { blobId: id, size: data.byteLength };
      }),
      download: vi.fn(async (id: string) => {
        await new Promise((r) => setTimeout(r, 5));
        return store.get(id)!.slice().buffer as ArrayBuffer;
      }),
    };
    return { t, store };
  }

  it("downloads a blob once, however many ask at the same moment", async () => {
    const { t, store } = transport();
    store.set("a".repeat(64), new Uint8Array([1, 2, 3]));
    const blobs = new BlobStore(t, "ctx", false);
    const all = await Promise.all([blobs.get("a".repeat(64)), blobs.get("a".repeat(64)), blobs.get("a".repeat(64))]);
    expect(new Uint8Array(all[0]!)).toEqual(new Uint8Array([1, 2, 3]));
    await blobs.get("a".repeat(64));
    expect(t.download).toHaveBeenCalledTimes(1);
  });

  it("never downloads what it just uploaded", async () => {
    const { t } = transport();
    const blobs = new BlobStore(t, "ctx", false);
    const { blobId } = await blobs.put(new Uint8Array([9, 9]));
    expect(new Uint8Array(await blobs.get(blobId))).toEqual(new Uint8Array([9, 9]));
    expect(t.download).not.toHaveBeenCalled();
  });
});
