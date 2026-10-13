import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LockView,
  MeshRef,
  SceneInfo,
  SceneObject,
  TextureRef,
  VersionView,
} from "../generated/MeroModelsClient";
import { BlobStore, type BlobTransport } from "./blobs";
import { makeShape } from "./geometry";
import { encodeMesh } from "./meshcodec";
import { defaultEnvironment, makeObject } from "./model";
import { useEditor } from "./store";
import { SceneSync, type SceneApi } from "./sync";

/** Content-addressed like the node: the id is a hash of the bytes. */
function hashOf(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 16777619);
    h2 = Math.imul(h2 + b, 2246822519);
  }
  const part = (h: number) => (h >>> 0).toString(16).padStart(8, "0");
  return (part(h1) + part(h2)).repeat(4);
}

/** A node in memory: blobs, the contract's records, and calls it can hold open. */
function fakeNode() {
  const objects = new Map<string, SceneObject>();
  const meshes = new Map<string, MeshRef>();
  const textures = new Map<string, TextureRef>();
  const history: { asset: string; blob: string; a: number; b: number }[] = [];
  const locks = new Map<string, LockView>();
  const blobs = new Map<string, Uint8Array>();
  let stamp = 1;
  const gates: (() => void)[] = [];
  let hold = false;
  const gate = () => (hold ? new Promise<void>((r) => gates.push(r)) : Promise.resolve());
  const transport: BlobTransport = {
    upload: vi.fn(async (data: Uint8Array) => {
      const blobId = hashOf(data);
      blobs.set(blobId, data.slice());
      return { blobId, size: data.byteLength };
    }),
    download: vi.fn(async (blobId: string) => {
      const b = blobs.get(blobId);
      if (!b) throw new Error("404");
      return b.slice().buffer as ArrayBuffer;
    }),
  };
  const api: SceneApi = {
    getScene: async (): Promise<SceneInfo> => ({
      name: "Scene",
      environment: defaultEnvironment(),
      object_count: objects.size,
      mesh_count: meshes.size,
      texture_count: textures.size,
      member_count: 1,
      me: "me",
      my_role: "admin",
    }),
    getObjects: async () => [...objects.values()].map((o) => ({ ...o })),
    getMembers: async () => [{ id: "me", name: "Ada", role: "admin", joined_at: 0 }],
    listMeshes: async () => [...meshes.values()],
    listTextures: async () => [...textures.values()],
    listLocks: async () => [...locks.values()],
    listHistory: async ({ asset_id }: { asset_id: string }): Promise<VersionView[]> =>
      history
        .filter((h) => h.asset === asset_id)
        .map((h, i) => ({
          number: i + 1,
          kind: "mesh",
          blob_id: h.blob,
          size: 1,
          a: h.a,
          b: h.b,
          author: "me",
          message: "",
          created_at: i,
          current: meshes.get(asset_id)?.blob_id === h.blob,
        })),
    putObjects: vi.fn(async ({ objects: puts }: { objects: SceneObject[] }) => {
      await gate();
      for (const o of puts) objects.set(o.id, { ...o, updated_at: stamp++ });
      return puts.map((o) => o.id);
    }),
    deleteObjects: vi.fn(async ({ ids }: { ids: string[] }) => {
      await gate();
      for (const id of ids) {
        objects.delete(id);
        meshes.delete(id);
      }
    }),
    putMesh: vi.fn(async ({ mesh }: { mesh: MeshRef }) => {
      await gate();
      if (!blobs.has(mesh.blob_id)) throw new Error("the blob was never uploaded");
      meshes.set(mesh.id, { ...mesh, updated_at: stamp++ });
      history.push({ asset: mesh.id, blob: mesh.blob_id, a: mesh.vertex_count, b: mesh.triangle_count });
    }),
    putTexture: vi.fn(async ({ texture }: { texture: TextureRef }) => {
      textures.set(texture.id, { ...texture, updated_at: stamp++ });
    }),
    deleteTextures: vi.fn(async () => {}),
    checkOut: vi.fn(async ({ ids }: { ids: string[] }) => {
      for (const id of ids) locks.set(id, { asset_id: id, holder: "me", since: 0, expires_at: Date.now() + 3_600_000, mine: true });
    }),
    checkIn: vi.fn(async ({ ids }: { ids: string[] }) => {
      for (const id of ids) locks.delete(id);
    }),
    setEnvironment: vi.fn(async () => {}),
  };
  return {
    api,
    transport,
    objects,
    meshes,
    locks,
    blobs,
    hold: () => (hold = true),
    release: () => {
      hold = false;
      gates.splice(0).forEach((r) => r());
    },
  };
}

function connect(node: ReturnType<typeof fakeNode>): SceneSync {
  const sync = new SceneSync(node.api, new BlobStore(node.transport, "ctx", false));
  useEditor.getState().setOutbox(sync);
  return sync;
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const triangle = () => makeShape([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 2]);

beforeEach(() => {
  useEditor.setState({
    objects: new Map(),
    meshes: new Map(),
    meshStatus: new Map(),
    textures: new Map(),
    locks: new Map(),
    selection: [],
    past: [],
    future: [],
    role: "admin",
    outbox: null,
  });
});

describe("SceneSync", () => {
  it("sends a commit and reads back the contract's stamps", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const cube = makeObject("cube", []);
    useEditor.getState().commit({ puts: [cube], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(cube.id)).toBe(true));
    await sync.refresh();
    await vi.waitFor(() => expect(useEditor.getState().objects.get(cube.id)?.updated_at).toBeGreaterThan(0));
  });

  it("does not let a read drag an object back while its write is in flight", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const cube = makeObject("cube", []);
    useEditor.getState().commit({ puts: [cube], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(cube.id)).toBe(true));
    await sync.refresh();

    node.hold();
    const moved = { ...cube, position: { x: 5, y: 0.5, z: 0 } };
    useEditor.getState().commit({ puts: [moved], deletes: [], meshes: [] }, "Move");
    await flush();
    await sync.refresh();
    expect(useEditor.getState().objects.get(cube.id)?.position.x).toBe(5);
    node.release();
    await vi.waitFor(() => expect(node.objects.get(cube.id)?.position.x).toBe(5));
    await sync.refresh();
    expect(useEditor.getState().objects.get(cube.id)?.position.x).toBe(5);
  });

  it("folds a burst of queued edits into one write", async () => {
    const node = fakeNode();
    connect(node);
    const a = makeObject("cube", []);
    node.hold();
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    await flush();
    for (let x = 1; x <= 5; x += 1) {
      useEditor.getState().commit({ puts: [{ ...a, position: { x, y: 0, z: 0 } }], deletes: [], meshes: [] }, "Move");
    }
    node.release();
    await vi.waitFor(() => expect(node.objects.get(a.id)?.position.x).toBe(5));
    expect(node.api.putObjects).toHaveBeenCalledTimes(2);
  });

  it("drops a remote delete, and keeps a local add the node has not seen yet", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const a = makeObject("cube", []);
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(a.id)).toBe(true));
    await sync.refresh();

    node.objects.delete(a.id);
    node.hold();
    const b = makeObject("sphere", []);
    useEditor.getState().commit({ puts: [b], deletes: [], meshes: [] }, "Add");
    await flush();
    await sync.refresh();
    const ids = [...useEditor.getState().objects.keys()];
    expect(ids).toContain(b.id);
    expect(ids).not.toContain(a.id);
    node.release();
  });
});

describe("meshes as blobs", () => {
  it("a mesh save uploads one blob and points the reference at it; reading it back downloads nothing", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const m = { ...makeObject("mesh", []), id: "m" };
    useEditor.getState().commit({ puts: [m], deletes: [], meshes: [{ id: "m", shape: triangle() }] }, "Add");
    await vi.waitFor(() => expect(node.meshes.get("m")?.vertex_count).toBe(3));
    expect(node.transport.upload).toHaveBeenCalledTimes(1);
    await sync.refresh();
    const stored = useEditor.getState().meshes.get("m")!;
    expect(stored.ref?.blob_id).toBe(node.meshes.get("m")!.blob_id);
    expect(node.transport.download).not.toHaveBeenCalled();
  });

  it("a mesh another member saved is downloaded, decoded and validated against its reference", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const bytes = encodeMesh(triangle());
    const { blobId, size } = await node.transport.upload(bytes, "ctx");
    node.objects.set("m", { ...makeObject("mesh", []), id: "m", updated_at: 1 });
    node.meshes.set("m", { id: "m", blob_id: blobId, size, vertex_count: 3, triangle_count: 1, has_uvs: false, author: "bob", message: "", updated_at: 2 });
    await sync.refresh();
    await vi.waitFor(() => expect(useEditor.getState().meshes.get("m")?.shape.indices).toEqual(new Uint32Array([0, 1, 2])));
    expect(useEditor.getState().meshStatus.has("m")).toBe(false);

    // A reference that lies about what is in the blob is refused, not drawn.
    node.meshes.set("m", { ...node.meshes.get("m")!, vertex_count: 99, updated_at: 3, blob_id: hashOf(new Uint8Array([1])) });
    node.blobs.set(hashOf(new Uint8Array([1])), bytes);
    await sync.refresh();
    await vi.waitFor(() => expect(useEditor.getState().meshStatus.get("m")).toMatch(/reference says/));
  });

  it("undoing a mesh edit re-saves the earlier shape, and the identical bytes re-use the identical blob", async () => {
    const node = fakeNode();
    connect(node);
    const m = { ...makeObject("mesh", []), id: "m" };
    useEditor.getState().commit({ puts: [m], deletes: [], meshes: [{ id: "m", shape: triangle() }] }, "Add");
    await vi.waitFor(() => expect(node.meshes.has("m")).toBe(true));
    const first = node.meshes.get("m")!.blob_id;
    const bigger = makeShape([0, 0, 0, 2, 0, 0, 0, 2, 0], [0, 1, 2]);
    useEditor.getState().commit({ puts: [], deletes: [], meshes: [{ id: "m", shape: bigger }] }, "Scale vertices");
    await vi.waitFor(() => expect(node.meshes.get("m")!.blob_id).not.toBe(first));
    useEditor.getState().undo();
    await vi.waitFor(() => expect(node.meshes.get("m")!.blob_id).toBe(first));
    expect(node.blobs.size).toBe(2);
  });
});

describe("check-out", () => {
  it("an object checked out by someone else is read-only here", async () => {
    const node = fakeNode();
    const sync = connect(node);
    const a = makeObject("cube", []);
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(a.id)).toBe(true));
    node.locks.set(a.id, { asset_id: a.id, holder: "bob", since: 0, expires_at: Date.now() + 60_000, mine: false });
    await sync.refresh();
    useEditor.getState().commit({ puts: [{ ...a, name: "Mine now" }], deletes: [], meshes: [] }, "Rename");
    expect(useEditor.getState().objects.get(a.id)?.name).toBe(a.name);
    expect(useEditor.getState().notice?.text).toMatch(/checked out/);
    expect(node.api.putObjects).toHaveBeenCalledTimes(1);
  });

  it("check-out and check-in go through the contract and come back as locks", async () => {
    const node = fakeNode();
    const sync = connect(node);
    await sync.checkOut(["x"], 8);
    expect(useEditor.getState().locks.get("x")?.mine).toBe(true);
    await sync.checkIn(["x"]);
    expect(useEditor.getState().locks.has("x")).toBe(false);
  });
});

describe("undo and redo", () => {
  it("undo of a delete puts the object and its mesh back", () => {
    const sent: unknown[] = [];
    useEditor.getState().setOutbox({ send: (c) => sent.push(c) });
    const m = { ...makeObject("mesh", []), id: "m" };
    const shape = triangle();
    useEditor.getState().commit({ puts: [m], deletes: [], meshes: [{ id: "m", shape }] }, "Add");
    useEditor.getState().commit({ puts: [], deletes: ["m"], meshes: [] }, "Delete");
    expect(useEditor.getState().objects.has("m")).toBe(false);
    useEditor.getState().undo();
    expect(useEditor.getState().objects.has("m")).toBe(true);
    expect(useEditor.getState().meshes.get("m")?.shape).toEqual(shape);
    useEditor.getState().redo();
    expect(useEditor.getState().objects.has("m")).toBe(false);
    expect(sent).toHaveLength(4);
  });

  it("a change that changes nothing is not an undo step", () => {
    useEditor.getState().setOutbox({ send: () => {} });
    const a = makeObject("cube", []);
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    useEditor.getState().commit({ puts: [{ ...a }], deletes: [], meshes: [] }, "Nothing");
    expect(useEditor.getState().past).toHaveLength(1);
  });

  it("a viewer cannot commit", () => {
    useEditor.setState({ role: "viewer" });
    useEditor.getState().commit({ puts: [makeObject("cube", [])], deletes: [], meshes: [] }, "Add");
    expect(useEditor.getState().objects.size).toBe(0);
    expect(useEditor.getState().notice?.error).toBe(true);
  });
});
