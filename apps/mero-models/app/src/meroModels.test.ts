import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  CALLS,
  MeroModelsClient,
  VIEWS,
  resolveParents,
  type Environment,
  type MeshRef,
  type SceneObject,
  type TextureRef,
} from "./meroModels";
import { clientTransport, tooLarge } from "./editor/blobs";
import { MAX_BLOB_BYTES, makeObject } from "./editor/model";

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, "../../logic/res/abi.json"), "utf8")) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
};

/** The views that answer one page (`{ items, next }`); the adapter follows `next`. */
const PAGED = new Set(["getObjects", "listMeshes", "listTextures", "listLocks", "getMembers"]);

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const ENV: Environment = { name: "", background: "#24262b", ambient_color: "#ffffff", ambient_intensity: 0.35, updated_at: 0 };
const MESH: MeshRef = {
  id: "m",
  blob_id: "ab".repeat(32),
  size: 10,
  vertex_count: 3,
  triangle_count: 1,
  has_uvs: false,
  author: "",
  message: "",
  updated_at: 0,
};
const TEXTURE: TextureRef = {
  id: "t",
  name: "T",
  blob_id: "cd".repeat(32),
  size: 10,
  width: 1,
  height: 1,
  mime: "image/png",
  color_space: "srgb",
  author: "",
  message: "",
  updated_at: 0,
};

describe("the client covers the contract", () => {
  it("calls exactly the contract's calls, and views exactly its views", () => {
    expect([...CALLS].sort()).toEqual(byKind("call"));
    expect([...VIEWS].sort()).toEqual(byKind("view"));
    expect(byKind("init")).toEqual(["init"]);
  });

  it("sends each method the parameter names the ABI declares", async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result = PAGED.has(method) ? { items: [], next: null } : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const c = new MeroModelsClient({ call: vi.fn(record), view: vi.fn(record) }, "app-1");
    const now = 1;
    await Promise.all([
      c.getScene(),
      c.setEnvironment({ environment: ENV, now }),
      c.getObjects(),
      c.getObjectsByIds({ ids: [] }),
      c.putObjects({ objects: [], now }),
      c.deleteObjects({ ids: [], now }),
      c.clearScene(),
      c.putMesh({ mesh: MESH, now }),
      c.listMeshes(),
      c.putTexture({ texture: TEXTURE, now }),
      c.listTextures(),
      c.deleteTextures({ ids: [], now }),
      c.listHistory({ asset_id: "m" }),
      c.checkOut({ ids: [], hours: 1, now }),
      c.checkIn({ ids: [] }),
      c.listLocks({ now }),
      c.join({ name: "A", now }),
      c.getMembers(),
      c.grantEditor({ member: "x" }),
      c.revokeEditor({ member: "x" }),
      c.myRole(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === "init") continue;
      // Optional parameters (a page's `cursor` and `limit`) may be left out.
      const required = method.params.filter(([, ty]) => !ty.startsWith("option<")).map(([p]) => p);
      const all = method.params.map(([p]) => p);
      const got = sent.get(name) ?? [];
      expect(got.filter((p) => !all.includes(p)), name).toEqual([]);
      expect(required.filter((p) => !got.includes(p)), name).toEqual([]);
    }
    expect([...PAGED].every((m) => abi.methods[m]?.params.some(([p]) => p === "cursor"))).toBe(true);
  });
});

describe("paged views", () => {
  const obj = (id: string, parent: string, created_at: number) =>
    ({ id, parent, created_at }) as unknown as SceneObject;

  it("follows `next` to the last page and answers v1's order", async () => {
    const pages: Record<string, { items: unknown[]; next: string | null }> = {
      "": { items: [obj("b", "", 2), obj("c", "", 1)], next: "k1" },
      k1: { items: [obj("a", "", 2)], next: null },
    };
    const view = vi.fn((_app: string, _m: string, args: { cursor?: string }) =>
      Promise.resolve({ index: 1, result: pages[args.cursor ?? ""] }),
    );
    const c = new MeroModelsClient({ call: vi.fn(), view }, "app-1");
    // Creation time, then id.
    expect((await c.getObjects()).map((o) => o.id)).toEqual(["c", "a", "b"]);
    expect(view).toHaveBeenNthCalledWith(1, "app-1", "getObjects", {});
    expect(view).toHaveBeenNthCalledWith(2, "app-1", "getObjects", { cursor: "k1" });
  });

  it("orders members oldest first and textures by name", async () => {
    const view = vi.fn((_app: string, method: string) =>
      Promise.resolve({
        index: 1,
        result:
          method === "getMembers"
            ? { items: [{ id: "z", joined_at: 1 }, { id: "a", joined_at: 2 }], next: null }
            : { items: [{ id: "1", name: "Zinc" }, { id: "2", name: "Albedo" }], next: null },
      }),
    );
    const c = new MeroModelsClient({ call: vi.fn(), view }, "app-1");
    expect((await c.getMembers()).map((m) => m.id)).toEqual(["z", "a"]);
    expect((await c.listTextures()).map((t) => t.name)).toEqual(["Albedo", "Zinc"]);
  });

  it("resolves a missing parent or a loop to a root, as v1's contract did", () => {
    const out = resolveParents([
      obj("a", "b", 0),
      obj("b", "a", 0),
      obj("orphan", "gone", 0),
      obj("root", "", 0),
      obj("leaf", "root", 0),
      obj("deep", "leaf", 0),
    ]);
    expect(Object.fromEntries(out.map((o) => [o.id, o.parent]))).toEqual({
      a: "",
      b: "",
      orphan: "",
      root: "",
      leaf: "root",
      deep: "leaf",
    });
  });
});

describe("MeroModelsClient", () => {
  it("routes calls through the log and views to a node, `now` as a decimal string", async () => {
    const call = vi.fn().mockResolvedValue({ index: 3, result: ["a"], events: [] });
    const view = vi.fn().mockResolvedValue({ index: 3, result: [] });
    const after = vi.fn();
    const c = new MeroModelsClient({ call, view }, "app-1", after);
    const cube = { ...makeObject("cube", []), id: "a" };

    expect(await c.putObjects({ objects: [cube], now: 1727000000000.7 })).toEqual(["a"]);
    expect(call).toHaveBeenCalledWith("app-1", "putObjects", { objects: [cube], now: "1727000000000" });
    await c.listHistory({ asset_id: "m" });
    expect(view).toHaveBeenCalledWith("app-1", "listHistory", { assetId: "m" });
    expect(after).toHaveBeenCalledTimes(2);
  });

  it("runs `after` when a request fails too", async () => {
    const after = vi.fn();
    const c = new MeroModelsClient(
      { call: vi.fn().mockRejectedValue(new Error("422 Forbidden")), view: vi.fn() },
      "app-1",
      after,
    );
    await expect(c.clearScene()).rejects.toThrow("Forbidden");
    expect(after).toHaveBeenCalledOnce();
  });
});

describe("blobs", () => {
  it("uploads to the scene and names the blob by its lowercase hex id", async () => {
    const uploadBlob = vi.fn().mockResolvedValue({ blobId: "base58", id: "AB".repeat(32), size: 3 });
    const downloadBlob = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const t = clientTransport({ uploadBlob, downloadBlob });
    expect(await t.upload(new Uint8Array(3), "app-1")).toEqual({ blobId: "ab".repeat(32), size: 3 });
    expect(uploadBlob).toHaveBeenCalledWith("app-1", new Uint8Array(3));
    expect(new Uint8Array(await t.download("ab".repeat(32), "app-1"))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a blob larger than one sealed request carries, before uploading", async () => {
    expect(MAX_BLOB_BYTES).toBe(49_545_216);
    expect(tooLarge(MAX_BLOB_BYTES)).toBeNull();
    expect(tooLarge(MAX_BLOB_BYTES + 1)).toContain("at most 47.25 MiB");
    const uploadBlob = vi.fn();
    const t = clientTransport({ uploadBlob, downloadBlob: vi.fn() });
    await expect(t.upload(new Uint8Array(MAX_BLOB_BYTES + 1), "app-1")).rejects.toThrow("47.25 MiB");
    expect(uploadBlob).not.toHaveBeenCalled();
  });
});
