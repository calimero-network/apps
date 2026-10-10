import type { MeroModelsClient, MeshData } from "../generated/MeroModelsClient";
import type { MeshShape } from "./geometry";
import { MAX_BATCH, type Environment, type SceneObject } from "./model";
import { emptyChange, useEditor, type Change, type Outbox, type Role, type StoredMesh } from "./store";

/** The slice of the generated client the sync needs — narrowed so tests can fake it. */
export type SceneApi = Pick<
  MeroModelsClient,
  | "getScene"
  | "getObjects"
  | "listMeshes"
  | "getMeshes"
  | "putObjects"
  | "deleteObjects"
  | "putMesh"
  | "setEnvironment"
>;

/** Vertices to fetch per `get_meshes` call, so one response stays a reasonable size. */
const MESH_FETCH_BUDGET = 60_000;

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

  constructor(
    private api: SceneApi,
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
    for (const m of change.meshes) {
      const mesh: MeshData = { id: m.id, positions: m.shape.positions, indices: m.shape.indices, updated_at: 0 };
      await this.api.putMesh({ mesh, now });
    }
    for (let i = 0; i < change.deletes.length; i += MAX_BATCH) {
      await this.api.deleteObjects({ ids: change.deletes.slice(i, i + MAX_BATCH) });
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
    const [scene, serverObjects, stamps] = await Promise.all([
      this.api.getScene(),
      this.api.getObjects(),
      this.api.listMeshes(),
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

    // ── meshes ──
    const want: string[] = [];
    const removed: string[] = [];
    const stampIds = new Set<string>();
    for (const stamp of stamps) {
      stampIds.add(stamp.id);
      if (!this.fresh(`m:${stamp.id}`, start)) continue;
      if (state.meshes.get(stamp.id)?.updated_at !== stamp.updated_at) want.push(stamp.id);
    }
    for (const id of state.meshes.keys()) {
      if (!stampIds.has(id) && this.fresh(`m:${id}`, start)) removed.push(id);
    }
    const fetched = new Map<string, StoredMesh>();
    const sizes = new Map(stamps.map((s) => [s.id, s.vertex_count]));
    let batch: string[] = [];
    let budget = 0;
    const flush = async () => {
      if (!batch.length) return;
      for (const m of await this.api.getMeshes({ ids: batch })) {
        fetched.set(m.id, {
          shape: { positions: m.positions, indices: m.indices },
          updated_at: m.updated_at,
        });
      }
      batch = [];
      budget = 0;
    };
    for (const id of want) {
      const size = sizes.get(id) ?? 0;
      if (batch.length && budget + size > MESH_FETCH_BUDGET) await flush();
      batch.push(id);
      budget += size;
    }
    await flush();
    if (this.disposed) return;

    useEditor.getState().receive({
      objects: next,
      meshes: fetched,
      removedMeshes: removed,
      environment: this.fresh("env", start) ? scene.environment : undefined,
      sceneName: scene.name,
      role: scene.my_role as Role,
      me: scene.me,
    });
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
