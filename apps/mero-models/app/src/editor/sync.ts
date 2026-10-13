import type { LockView, MeroModelsClient, MeshRef, TextureRef, VersionView } from "../generated/MeroModelsClient";
import type { BlobStore } from "./blobs";
import type { MeshShape } from "./geometry";
import { decodeMesh, encodeMesh, meshCounts } from "./meshcodec";
import { MAX_BATCH, type Environment, type SceneObject } from "./model";
import { emptyChange, useEditor, type Change, type Outbox, type Role, type StoredMesh } from "./store";

/** The slice of the generated client the sync needs — narrowed so tests can fake it. */
export type SceneApi = Pick<
  MeroModelsClient,
  | "getScene"
  | "getObjects"
  | "listMeshes"
  | "listTextures"
  | "listLocks"
  | "listHistory"
  | "getMembers"
  | "putObjects"
  | "deleteObjects"
  | "putMesh"
  | "putTexture"
  | "deleteTextures"
  | "checkOut"
  | "checkIn"
  | "setEnvironment"
>;

/** Mesh blobs downloaded at once; the rest wait their turn. */
const MESH_FETCH_PARALLEL = 3;

/**
 * The bridge between the local model and the contract.
 *
 * The editor is optimistic — a drag shows where the cube is at once, not a
 * round trip later — so the hard part is the other direction: a read from the
 * node must not drag an object back to where it was while the write that moved
 * it is still on its way. Every write marks the ids it touches as PENDING until
 * it lands, and a read keeps the local copy of anything pending, or anything
 * whose write landed after the read started (the read may predate it).
 *
 * Writes go out one change at a time, in order. Consecutive changes waiting in
 * the queue are folded together, so a burst of edits is one transaction rather
 * than a queue of stale ones.
 */
export class SceneSync implements Outbox {
  private queue: Change[] = [];
  private envQueue: Environment | null = null;
  private busy = false;
  private tick = 0;
  private pending = new Map<string, number>();
  private held = new Map<Change, string[]>();
  private completed = new Map<string, number>();
  private refreshing = false;
  private refreshAgain = false;
  private disposed = false;
  /** The shape each of OUR uploads encoded, by mesh id — so reading back our own save adopts its reference instead of downloading and decoding the blob we just sent. */
  private uploaded = new Map<string, { blobId: string; shape: MeshShape }>();
  /** Mesh blobs being fetched, by blob id. */
  private fetching = new Set<string>();
  /** The newest reference each mesh had at the last read — a download that lands after a newer one was written is dropped. */
  private latest = new Map<string, string>();

  constructor(
    private api: SceneApi,
    readonly blobs: BlobStore,
    private onError: (message: string) => void = () => {},
  ) {}

  dispose(): void {
    this.disposed = true;
  }

  /** True while anything is queued or in flight — the status bar's "Saving…". */
  get saving(): boolean {
    return this.busy || this.queue.length > 0 || this.envQueue !== null;
  }

  send(change: Change): void {
    const keys = keysOf(change);
    for (const key of keys) this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    const tail = this.queue.at(-1);
    let target: Change;
    if (tail && canFold(tail, change)) {
      fold(tail, change);
      target = tail;
    } else {
      target = { puts: change.puts.slice(), deletes: change.deletes.slice(), meshes: change.meshes.slice() };
      this.queue.push(target);
    }
    // Every key this send marked pending is released when the change it was
    // folded into lands, so the counts balance however much folding happened.
    this.held.set(target, [...(this.held.get(target) ?? []), ...keys]);
    void this.pump();
  }

  sendEnvironment(environment: Environment): void {
    if (this.envQueue === null) this.pending.set("env", (this.pending.get("env") ?? 0) + 1);
    this.envQueue = environment;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.envQueue) {
          const env = this.envQueue;
          this.envQueue = null;
          try {
            await this.api.setEnvironment({ environment: env, now: Date.now() });
          } catch (e) {
            this.onError(messageOf(e));
          } finally {
            this.release(["env"]);
          }
          continue;
        }
        const change = this.queue.shift();
        if (!change) break;
        try {
          await this.write(change);
        } catch (e) {
          this.onError(messageOf(e));
        } finally {
          this.release(this.held.get(change) ?? []);
          this.held.delete(change);
        }
      }
    } finally {
      this.busy = false;
    }
    // Read back: picks up the contract's stamps, and — after a refusal —
    // puts the model back to what the node actually holds.
    await this.refresh();
  }

  private async write(change: Change): Promise<void> {
    const now = Date.now();
    for (let i = 0; i < change.puts.length; i += MAX_BATCH) {
      await this.api.putObjects({ objects: change.puts.slice(i, i + MAX_BATCH), now });
    }
    for (const m of change.meshes) await this.saveMesh(m.id, m.shape, m.message ?? "");
    for (let i = 0; i < change.deletes.length; i += MAX_BATCH) {
      await this.api.deleteObjects({ ids: change.deletes.slice(i, i + MAX_BATCH), now: Date.now() });
    }
  }

  /**
   * Encode, upload, then point the mesh at the blob — which also records a
   * version. Identical bytes give the identical blob id, so undoing to an
   * earlier shape re-uses its blob rather than storing it twice.
   */
  private async saveMesh(id: string, shape: MeshShape, message: string, known?: { blobId: string; size: number }): Promise<void> {
    const blob = known ?? (await this.blobs.put(encodeMesh(shape)));
    this.uploaded.set(id, { blobId: blob.blobId, shape });
    const mesh: MeshRef = {
      id,
      blob_id: blob.blobId,
      size: blob.size,
      ...meshCounts(shape),
      has_uvs: !!shape.uvs,
      author: "",
      message,
      updated_at: 0,
    };
    await this.api.putMesh({ mesh, now: Date.now() });
  }

  /** Put an earlier version back: the same blob, as a new version. */
  async restoreMesh(id: string, version: VersionView): Promise<void> {
    const shape = decodeMesh(await this.blobs.get(version.blob_id), { vertex_count: version.a, triangle_count: version.b });
    const before = useEditor.getState().meshes.get(id)?.shape;
    useEditor.getState().commit(
      { puts: [], deletes: [], meshes: [{ id, shape, message: `Restored v${version.number}` }] },
      `Restore v${version.number}`,
      before ? { objects: new Map(), meshes: new Map([[id, before]]) } : undefined,
    );
  }

  /** Record the current shape again as a named version. Same bytes, same blob: nothing is uploaded twice. */
  async saveVersion(id: string, message: string): Promise<void> {
    const stored = useEditor.getState().meshes.get(id);
    if (!stored) return;
    await this.run(() => this.saveMesh(id, stored.shape, message));
  }

  listHistory(assetId: string): Promise<VersionView[]> {
    return this.api.listHistory({ asset_id: assetId });
  }

  /** Upload an image and add (or replace) a texture. Not an undo step: textures are versioned instead. */
  async putTexture(texture: Omit<TextureRef, "blob_id" | "size" | "author" | "updated_at">, bytes: Uint8Array): Promise<void> {
    await this.run(async () => {
      const blob = await this.blobs.put(bytes);
      await this.api.putTexture({
        texture: { ...texture, blob_id: blob.blobId, size: blob.size, author: "", updated_at: 0 },
        now: Date.now(),
      });
    });
  }

  async restoreTexture(texture: TextureRef, version: VersionView): Promise<void> {
    await this.run(() =>
      this.api.putTexture({
        texture: { ...texture, blob_id: version.blob_id, size: version.size, width: version.a, height: version.b, message: `Restored v${version.number}` },
        now: Date.now(),
      }),
    );
  }

  deleteTextures(ids: string[]): Promise<void> {
    return this.run(() => this.api.deleteTextures({ ids, now: Date.now() }));
  }

  checkOut(ids: string[], hours: number): Promise<void> {
    return this.run(() => this.api.checkOut({ ids, hours, now: Date.now() }));
  }

  checkIn(ids: string[]): Promise<void> {
    return this.run(() => this.api.checkIn({ ids }));
  }

  /** One direct call, reported like a write, followed by a read. */
  private async run(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.onError(messageOf(e));
    } finally {
      await this.refresh();
    }
  }

  private release(keys: string[]): void {
    this.tick += 1;
    for (const key of keys) {
      const n = (this.pending.get(key) ?? 1) - 1;
      if (n <= 0) this.pending.delete(key);
      else this.pending.set(key, n);
      this.completed.set(key, this.tick);
    }
  }

  /** May a read that started at `start` overwrite the local copy of `key`? */
  private fresh(key: string, start: number): boolean {
    return !this.pending.has(key) && (this.completed.get(key) ?? -1) <= start;
  }

  /** Read the whole scene and fold it into the editor. Coalesces overlapping calls. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (this.refreshing) {
      this.refreshAgain = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.refreshAgain = false;
        await this.readOnce();
      } while (this.refreshAgain && !this.disposed);
    } catch (e) {
      this.onError(messageOf(e));
    } finally {
      this.refreshing = false;
    }
  }

  private async readOnce(): Promise<void> {
    const start = this.tick;
    const now = Date.now();
    const [scene, serverObjects, refs, textures, locks, members] = await Promise.all([
      this.api.getScene(),
      this.api.getObjects(),
      this.api.listMeshes(),
      this.api.listTextures(),
      this.api.listLocks({ now }),
      this.api.getMembers(),
    ]);
    if (this.disposed) return;
    const state = useEditor.getState();

    // ── objects ──
    const next = new Map<string, SceneObject>();
    const seen = new Set<string>();
    for (const server of serverObjects) {
      seen.add(server.id);
      const local = state.objects.get(server.id);
      if (this.fresh(`o:${server.id}`, start)) {
        // Keep the local reference when nothing changed, so the viewport does
        // not rebuild an object on every poll.
        next.set(
          server.id,
          local && local.updated_at === server.updated_at && local.created_by === server.created_by
            ? local
            : server,
        );
      } else if (local) {
        next.set(server.id, local);
      }
    }
    for (const [id, local] of state.objects) {
      if (!seen.has(id) && !this.fresh(`o:${id}`, start)) next.set(id, local);
    }

    // ── meshes: references now, blobs as they arrive ──
    const adopted = new Map<string, StoredMesh>();
    const removed: string[] = [];
    const wanted: MeshRef[] = [];
    const refIds = new Set<string>();
    this.latest = new Map(refs.map((r) => [r.id, r.blob_id]));
    for (const ref of refs) {
      refIds.add(ref.id);
      if (!this.fresh(`m:${ref.id}`, start)) continue;
      const stored = state.meshes.get(ref.id);
      if (stored?.ref?.blob_id === ref.blob_id) {
        if (stored.ref.updated_at !== ref.updated_at) adopted.set(ref.id, { shape: stored.shape, ref });
        continue;
      }
      const mine = this.uploaded.get(ref.id);
      if (mine?.blobId === ref.blob_id && stored?.shape === mine.shape) {
        adopted.set(ref.id, { shape: stored.shape, ref });
        continue;
      }
      wanted.push(ref);
    }
    for (const id of state.meshes.keys()) {
      if (!refIds.has(id) && this.fresh(`m:${id}`, start)) removed.push(id);
    }
    const status = new Map(state.meshStatus);
    for (const id of status.keys()) if (!refIds.has(id)) status.delete(id);
    for (const ref of wanted) if (!status.get(ref.id)) status.set(ref.id, "");

    useEditor.getState().receive({
      objects: next,
      meshes: adopted,
      removedMeshes: removed,
      meshStatus: status,
      textures: new Map(textures.map((t) => [t.id, t])),
      locks: new Map(locks.map((l: LockView) => [l.asset_id, l])),
      memberNames: new Map(members.map((m) => [m.id, m.name])),
      environment: this.fresh("env", start) ? scene.environment : undefined,
      sceneName: scene.name,
      role: scene.my_role as Role,
      me: scene.me,
    });
    this.fetchMeshes(wanted);
  }

  /**
   * Download and decode mesh blobs in the background, a few at a time. A big
   * mesh must not hold up the objects, the locks or the next poll, so the
   * read above returns first and each shape lands when it is ready.
   */
  private fetchMeshes(refs: MeshRef[]): void {
    const queue = refs.filter((r) => !this.fetching.has(r.blob_id));
    const worker = async () => {
      for (;;) {
        const ref = queue.shift();
        if (!ref || this.disposed) return;
        this.fetching.add(ref.blob_id);
        try {
          const shape = decodeMesh(await this.blobs.get(ref.blob_id), ref);
          const st = useEditor.getState();
          // Only if the reference is still the current one and nobody is editing it.
          if (!this.pending.has(`m:${ref.id}`) && this.latest.get(ref.id) === ref.blob_id) {
            const status = new Map(st.meshStatus);
            status.delete(ref.id);
            st.receive({ meshes: new Map([[ref.id, { shape, ref }]]), meshStatus: status });
          }
        } catch (e) {
          const st = useEditor.getState();
          const status = new Map(st.meshStatus);
          status.set(ref.id, messageOf(e));
          st.receive({ meshStatus: status });
        } finally {
          this.fetching.delete(ref.blob_id);
        }
      }
    };
    for (let i = 0; i < MESH_FETCH_PARALLEL; i += 1) void worker();
  }
}

function keysOf(change: Change): string[] {
  return [
    ...change.puts.map((o) => `o:${o.id}`),
    ...change.deletes.flatMap((id) => [`o:${id}`, `m:${id}`]),
    ...change.meshes.map((m) => `m:${m.id}`),
  ];
}

/**
 * Can `next` be folded into the queued `tail` without changing what the pair
 * means? Writes go out as puts, then meshes, then deletes, so a put of an id
 * the tail deletes would be undone by its own delete — that case queues.
 */
function canFold(tail: Change, next: Change): boolean {
  const tailDeletes = new Set(tail.deletes);
  return (
    !next.puts.some((o) => tailDeletes.has(o.id)) &&
    !next.meshes.some((m) => tailDeletes.has(m.id))
  );
}

function fold(tail: Change, next: Change): void {
  const doomed = new Set(next.deletes);
  const puts = new Map(tail.puts.filter((o) => !doomed.has(o.id)).map((o) => [o.id, o]));
  for (const o of next.puts) puts.set(o.id, o);
  const meshes = new Map<string, MeshShape>(
    tail.meshes.filter((m) => !doomed.has(m.id)).map((m) => [m.id, m.shape]),
  );
  for (const m of next.meshes) meshes.set(m.id, m.shape);
  tail.puts = [...puts.values()];
  tail.meshes = [...meshes].map(([id, shape]) => ({ id, shape }));
  tail.deletes = [...new Set([...tail.deletes, ...next.deletes])];
}

export function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Something went wrong talking to the node.";
  }
}

export { emptyChange };
