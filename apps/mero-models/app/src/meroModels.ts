import type { CalimeroClient } from "@calimero-network/mero-js";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.mero-models";

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `meroModels.test.ts` asserts these lists, and every method's
 * parameter names, are exactly the committed `logic/res/abi.json`'s, so a
 * method the contract drops or renames fails a test rather than a request.
 */
export const CALLS = [
  "setEnvironment",
  "putObjects",
  "deleteObjects",
  "clearScene",
  "putMesh",
  "putTexture",
  "deleteTextures",
  "checkOut",
  "checkIn",
  "join",
  "grantEditor",
  "revokeEditor",
] as const;
export const VIEWS = [
  "getScene",
  "getObjects",
  "getObjectsByIds",
  "listMeshes",
  "listTextures",
  "listHistory",
  "listLocks",
  "getMembers",
  "myRole",
] as const;

// ── What the screens use ────────────────────────────────────────────────────
//
// The shapes the editor was written against (v1's generated client). The
// contract keeps v1's snake_case record fields and answers them as JSON
// numbers; only the methods' own `now` parameter travels as a decimal string,
// which `MeroModelsClient` below converts.

/** A point or a direction in scene units, or Euler angles in radians. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How an object's surface looks. A light reads `color` as its light colour. */
export interface Material {
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  emissive: string;
  wireframe: boolean;
  flat_shading: boolean;
  base_color_map: string;
  normal_map: string;
  normal_scale: number;
  orm_map: string;
  emissive_map: string;
}

/** One object in the scene. */
export interface SceneObject {
  id: string;
  name: string;
  kind: string;
  parent: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  visible: boolean;
  material: Material;
  segments: number;
  intensity: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

/** The shape of a `mesh` object: a reference to the blob holding its vertices. */
export interface MeshRef {
  id: string;
  /** 64 lowercase hex characters: the `id` an upload answers. */
  blob_id: string;
  size: number;
  vertex_count: number;
  triangle_count: number;
  has_uvs: boolean;
  author: string;
  message: string;
  updated_at: number;
}

/** An image a material can use, held in a blob. */
export interface TextureRef {
  id: string;
  name: string;
  blob_id: string;
  size: number;
  width: number;
  height: number;
  mime: string;
  color_space: string;
  author: string;
  message: string;
  updated_at: number;
}

/** What surrounds the scene: its name, the background and the ambient light. */
export interface Environment {
  /** The scene's name; `""` shows the instance's name. */
  name: string;
  background: string;
  ambient_color: string;
  ambient_intensity: number;
  updated_at: number;
}

/** The scene's header. */
export interface SceneInfo {
  name: string;
  environment: Environment;
  object_count: number;
  mesh_count: number;
  texture_count: number;
  member_count: number;
  me: string;
  my_role: string;
}

/** One row of an asset's history, numbered from 1. */
export interface VersionView {
  number: number;
  kind: string;
  blob_id: string;
  size: number;
  a: number;
  b: number;
  author: string;
  message: string;
  created_at: number;
  current: boolean;
}

/** A live check-out. */
export interface LockView {
  asset_id: string;
  holder: string;
  since: number;
  expires_at: number;
  mine: boolean;
}

/** A member with their effective role. */
export interface MemberView {
  id: string;
  name: string;
  role: string;
  joined_at: number;
}

/** What the adapter needs of a signed-in `CalimeroClient`. */
export type MethodClient = Pick<CalimeroClient, "call" | "view">;

/** One page of a list view: `next` is the cursor of the following page, `null` after the last. */
export interface Page<T> {
  items: T[];
  next: string | null;
}

/**
 * Clear every `parent` that names a missing object or sits on a loop: the
 * contract's v1 `resolve_parents`, which ran inside `get_objects`. The view is
 * paged now, so the reader resolves once it holds every page, and every reader
 * of the same rows draws the same tree.
 */
export function resolveParents(objects: SceneObject[]): SceneObject[] {
  const parentOf = new Map(objects.map((o) => [o.id, o.parent]));
  return objects.map((o) => {
    if (!o.parent) return o;
    const seen = new Set([o.id]);
    let at = o.parent;
    for (;;) {
      if (!at) return o;
      if (seen.has(at)) break;
      seen.add(at);
      const next = parentOf.get(at);
      if (next === undefined) break;
      at = next;
    }
    return { ...o, parent: "" };
  });
}

/** Code-point order, as the contract's `String` sort was. */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A u64 parameter: a canonical decimal string (D20). */
function u64(n: number): string {
  return String(Math.max(0, Math.trunc(n)));
}

/**
 * v1's generated client, on `CalimeroClient`: the same methods with the same
 * snake_case argument objects and answers, so the editor did not change. Calls
 * go through the instance's log (`client.call`), views to a node
 * (`client.view`); `after` runs after each request (it keeps the stored
 * session current when the client swapped its refresh token).
 */
export class MeroModelsClient {
  constructor(
    private readonly client: MethodClient,
    readonly appId: string,
    private readonly after: () => void = () => {},
  ) {}

  private async call<T>(method: (typeof CALLS)[number], args: Record<string, unknown> = {}): Promise<T> {
    try {
      return (await this.client.call(this.appId, method, args)).result as T;
    } finally {
      this.after();
    }
  }

  private async view<T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T> {
    try {
      return (await this.client.view(this.appId, method, args)).result as T;
    } finally {
      this.after();
    }
  }

  /**
   * Every row of a paged view, following `next`. Each list is bounded by the
   * contract (2,000 objects, 1,000 textures) or by who joined; one page is at
   * most 1,000 rows.
   */
  private async pages<T>(method: (typeof VIEWS)[number], args: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<T> = await this.view<Page<T>>(method, cursor === null ? args : { ...args, cursor });
      out.push(...page.items);
      cursor = page.next;
    } while (cursor !== null);
    return out;
  }

  getScene(): Promise<SceneInfo> {
    return this.view("getScene");
  }

  setEnvironment(params: { environment: Environment; now: number }): Promise<void> {
    return this.call("setEnvironment", { environment: params.environment, now: u64(params.now) });
  }

  /** Every object, ordered by creation then id, parents resolved (v1's answer). */
  async getObjects(): Promise<SceneObject[]> {
    const all = await this.pages<SceneObject>("getObjects");
    all.sort((a, b) => a.created_at - b.created_at || cmp(a.id, b.id));
    return resolveParents(all);
  }

  getObjectsByIds(params: { ids: string[] }): Promise<SceneObject[]> {
    return this.view("getObjectsByIds", { ids: params.ids });
  }

  putObjects(params: { objects: SceneObject[]; now: number }): Promise<string[]> {
    return this.call("putObjects", { objects: params.objects, now: u64(params.now) });
  }

  deleteObjects(params: { ids: string[]; now: number }): Promise<void> {
    return this.call("deleteObjects", { ids: params.ids, now: u64(params.now) });
  }

  clearScene(): Promise<void> {
    return this.call("clearScene");
  }

  putMesh(params: { mesh: MeshRef; now: number }): Promise<void> {
    return this.call("putMesh", { mesh: params.mesh, now: u64(params.now) });
  }

  /** Every mesh's current reference, ordered by id. */
  listMeshes(): Promise<MeshRef[]> {
    return this.pages("listMeshes");
  }

  putTexture(params: { texture: TextureRef; now: number }): Promise<void> {
    return this.call("putTexture", { texture: params.texture, now: u64(params.now) });
  }

  /** Every texture, ordered by name then id (v1's answer). */
  async listTextures(): Promise<TextureRef[]> {
    const all = await this.pages<TextureRef>("listTextures");
    return all.sort((a, b) => cmp(a.name, b.name) || cmp(a.id, b.id));
  }

  deleteTextures(params: { ids: string[]; now: number }): Promise<void> {
    return this.call("deleteTextures", { ids: params.ids, now: u64(params.now) });
  }

  listHistory(params: { asset_id: string }): Promise<VersionView[]> {
    return this.view("listHistory", { assetId: params.asset_id });
  }

  checkOut(params: { ids: string[]; hours: number; now: number }): Promise<void> {
    return this.call("checkOut", { ids: params.ids, hours: params.hours, now: u64(params.now) });
  }

  checkIn(params: { ids: string[] }): Promise<void> {
    return this.call("checkIn", { ids: params.ids });
  }

  /** Every check-out live at `now`, ordered by asset id. */
  listLocks(params: { now: number }): Promise<LockView[]> {
    return this.pages("listLocks", { now: u64(params.now) });
  }

  join(params: { name: string; now: number }): Promise<void> {
    return this.call("join", { name: params.name, now: u64(params.now) });
  }

  /** Everyone who joined, oldest first (v1's answer). */
  async getMembers(): Promise<MemberView[]> {
    const all = await this.pages<MemberView>("getMembers");
    return all.sort((a, b) => a.joined_at - b.joined_at || cmp(a.id, b.id));
  }

  grantEditor(params: { member: string }): Promise<void> {
    return this.call("grantEditor", { member: params.member });
  }

  revokeEditor(params: { member: string }): Promise<void> {
    return this.call("revokeEditor", { member: params.member });
  }

  myRole(): Promise<string> {
    return this.view("myRole");
  }
}
