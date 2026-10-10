import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MeshData, MeshStamp, SceneInfo, SceneObject } from "../generated/MeroModelsClient";
import { defaultEnvironment, makeObject } from "./model";
import { useEditor } from "./store";
import { SceneSync, type SceneApi } from "./sync";

/** A node in memory: what the contract would store, with calls it can hold open. */
function fakeNode() {
  const objects = new Map<string, SceneObject>();
  const meshes = new Map<string, MeshData>();
  let stamp = 1;
  const gates: (() => void)[] = [];
  let hold = false;
  const gate = () => (hold ? new Promise<void>((r) => gates.push(r)) : Promise.resolve());
  const api: SceneApi = {
    getScene: async (): Promise<SceneInfo> => ({
      name: "Scene",
      environment: defaultEnvironment(),
      object_count: objects.size,
      mesh_count: meshes.size,
      member_count: 1,
      me: "me",
      my_role: "admin",
    }),
    getObjects: async () => [...objects.values()].map((o) => ({ ...o })),
    listMeshes: async (): Promise<MeshStamp[]> =>
      [...meshes.values()].map((m) => ({ id: m.id, updated_at: m.updated_at, vertex_count: m.positions.length / 3, triangle_count: m.indices.length / 3 })),
    getMeshes: async ({ ids }: { ids: string[] }) => ids.map((id) => meshes.get(id)).filter((m): m is MeshData => !!m),
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
    putMesh: vi.fn(async ({ mesh }: { mesh: MeshData }) => {
      await gate();
      meshes.set(mesh.id, { ...mesh, updated_at: stamp++ });
    }),
    setEnvironment: vi.fn(async () => {}),
  };
  return {
    api,
    objects,
    hold: () => (hold = true),
    release: () => {
      hold = false;
      gates.splice(0).forEach((r) => r());
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useEditor.setState({ objects: new Map(), meshes: new Map(), selection: [], past: [], future: [], role: "admin", outbox: null });
});

describe("SceneSync", () => {
  it("sends a commit and reads back the contract's stamps", async () => {
    const node = fakeNode();
    const sync = new SceneSync(node.api);
    useEditor.getState().setOutbox(sync);
    const cube = makeObject("cube", []);
    useEditor.getState().commit({ puts: [cube], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(cube.id)).toBe(true));
    await vi.waitFor(() => expect(useEditor.getState().objects.get(cube.id)?.updated_at).toBeGreaterThan(0));
  });

  it("does not let a read drag an object back while its write is in flight", async () => {
    const node = fakeNode();
    const sync = new SceneSync(node.api);
    useEditor.getState().setOutbox(sync);
    const cube = makeObject("cube", []);
    useEditor.getState().commit({ puts: [cube], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(cube.id)).toBe(true));
    await sync.refresh();

    // Move it, but hold the write open.
    node.hold();
    const moved = { ...cube, position: { x: 5, y: 0.5, z: 0 } };
    useEditor.getState().commit({ puts: [moved], deletes: [], meshes: [] }, "Move");
    await flush();
    // A poll lands while the node still has the old position…
    await sync.refresh();
    expect(useEditor.getState().objects.get(cube.id)?.position.x).toBe(5);
    // …and once the write lands, the read-back agrees.
    node.release();
    await vi.waitFor(() => expect(node.objects.get(cube.id)?.position.x).toBe(5));
    await sync.refresh();
    expect(useEditor.getState().objects.get(cube.id)?.position.x).toBe(5);
  });

  it("folds a burst of queued edits into one write", async () => {
    const node = fakeNode();
    const sync = new SceneSync(node.api);
    useEditor.getState().setOutbox(sync);
    const a = makeObject("cube", []);
    node.hold();
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    await flush();
    for (let x = 1; x <= 5; x += 1) {
      useEditor.getState().commit({ puts: [{ ...a, position: { x, y: 0, z: 0 } }], deletes: [], meshes: [] }, "Move");
    }
    node.release();
    await vi.waitFor(() => expect(node.objects.get(a.id)?.position.x).toBe(5));
    // The first write was in flight; the five moves behind it went as one.
    expect(node.api.putObjects).toHaveBeenCalledTimes(2);
  });

  it("drops a remote delete, and keeps a local add the node has not seen yet", async () => {
    const node = fakeNode();
    const sync = new SceneSync(node.api);
    useEditor.getState().setOutbox(sync);
    const a = makeObject("cube", []);
    useEditor.getState().commit({ puts: [a], deletes: [], meshes: [] }, "Add");
    await vi.waitFor(() => expect(node.objects.has(a.id)).toBe(true));
    await sync.refresh();

    node.objects.delete(a.id); // someone else deleted it
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

describe("undo and redo", () => {
  it("undo of a delete puts the object and its mesh back", () => {
    const sent: unknown[] = [];
    useEditor.getState().setOutbox({ send: (c) => sent.push(c) });
    const m = { ...makeObject("mesh", []), id: "m" };
    const shape = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
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
