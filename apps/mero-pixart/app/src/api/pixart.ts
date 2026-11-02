import type { CalimeroClient } from "@calimero-network/mero-js";

import type { DocumentInfo, Layer, Member, MemberRole, Role } from "../types";

/**
 * The MeroPixArt contract, typed (no client is generated from a component ABI
 * yet), and the ONE place its answers are adapted to the shapes the screens
 * use.
 *
 * The screens were written against v1's JSON-RPC: snake_case method and
 * argument names (`update_layer`, `updated_at`), plain numbers, whole lists.
 * The component contract takes and answers camelCase, carries 64-bit integers
 * as decimal strings (`"x": "-12"`, `"updatedAt": "1700000000000"`) and pages
 * every growing list (`{ items, next }`). {@link PixartClient.call} converts
 * both ways, so the screens keep calling `call(app, "get_layers", {})` and get
 * `Layer[]` back.
 *
 * Pixels moved out of the layer: a raster layer's `blobId` (one PNG) is now
 * 256 × 256 tiles (`getLayerTiles`), and the layer answers `pixelsRev` /
 * `maskRev` / `hasMask`. The adapter turns those into the `blobId` /
 * `maskBlobId` strings the screens key their caches by (`px:<id>:<rev>`), so a
 * layer whose pixels changed still reads as a new "blob" to reload.
 *
 * `pixart.test.ts` asserts the method lists and parameter names are exactly
 * the committed `logic/res/abi.json`'s.
 */
export const CALLS = [
  "addExport",
  "addLayer",
  "bringToFront",
  "clearLayers",
  "deleteExport",
  "deleteLayer",
  "grantEditor",
  "join",
  "moveLayer",
  "moveLayers",
  "reorderLayers",
  "revokeEditor",
  "sendToBack",
  "transferOwnership",
  "updateAdjustments",
  "updateDocument",
  "updateLayer",
  "updateLayerContent",
  "updateLayerMask",
  "updateMemberUsername",
  "updateText",
  "updateTransform",
] as const;

export const VIEWS = [
  "canEdit",
  "getDocument",
  "getExports",
  "getLayer",
  "getLayerTiles",
  "getLayers",
  "getMembers",
  "getRole",
  "listRoles",
  "myRole",
] as const;

export type Call = (typeof CALLS)[number];
export type View = (typeof VIEWS)[number];
export type Method = Call | View;

/**
 * Parameters typed `u64` / `i64` (or an `Option` of one) in the ABI: sent as
 * decimal strings. Checked against `abi.json` by the tests.
 */
export const INT_PARAMS: Partial<Record<Method, readonly string[]>> = {
  bringToFront: ["updatedAt"],
  join: ["timestamp"],
  moveLayer: ["updatedAt"],
  moveLayers: ["updatedAt"],
  reorderLayers: ["updatedAt"],
  sendToBack: ["updatedAt"],
  updateAdjustments: ["updatedAt"],
  updateLayer: ["x", "y", "updatedAt"],
  updateLayerContent: ["updatedAt"],
  updateLayerMask: ["updatedAt"],
  updateMemberUsername: ["timestamp"],
  updateText: ["updatedAt"],
  updateTransform: ["updatedAt"],
};

/** Fields of `NewLayer` (the `addLayer` argument) that are 64-bit integers. */
const NEW_LAYER_INTS = ["x", "y", "createdAt", "updatedAt"] as const;
/** Fields of the screens' `Layer` the contract does not take. */
const NOT_NEW_LAYER = ["blobId", "maskBlobId", "createdBy", "pixelsRev", "maskRev", "hasMask"] as const;

// ── the wire ─────────────────────────────────────────────────────────────────

/** A u64 / i64 travels as a decimal string. */
type Int = string;

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface WireLayer
  extends Omit<Layer, "x" | "y" | "createdAt" | "updatedAt" | "blobId" | "maskBlobId" | "pixelsRev" | "maskRev" | "hasMask"> {
  x: Int;
  y: Int;
  pixelsRev: Int;
  maskRev: Int;
  hasMask: boolean;
  createdAt: Int;
  updatedAt: Int;
}

interface WireMember {
  id: string;
  username: string;
  avatar: string | null;
  joinedAt: Int;
  usernameUpdatedAt: Int;
}

/** One stored tile of a layer's pixels or mask. */
export interface Tile {
  tx: number;
  ty: number;
  blobId: string;
}

/** One tile of a write: `blobId: null` removes an emptied tile. */
export interface TileWrite {
  tx: number;
  ty: number;
  blobId: string | null;
}

/** An image exported from the editor. */
export interface Export {
  id: string;
  blobId: string;
  name: string;
  format: "png" | "jpeg" | "svg";
  createdBy: string;
  createdAt: number;
}

/** A decimal string as a number. Coordinates and timestamps are well inside 2^53. */
export function int(value: Int | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

/** A number as the decimal string a u64 / i64 parameter takes. */
export function intArg(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number") return String(Math.trunc(value));
  return value;
}

/** The cache key the screens use for a layer's pixels at `rev` ("" = none yet). */
export function pixelsKey(id: string, rev: number): string {
  return rev > 0 ? `px:${id}:${rev}` : "";
}

/** The cache key the screens use for a layer's mask at `rev` (null = none). */
export function maskKey(id: string, rev: number, hasMask: boolean): string | null {
  return hasMask ? `mask:${id}:${rev}` : null;
}

/** The revision a key from {@link pixelsKey} / {@link maskKey} names, 0 for none. */
export function revOf(key: string | null | undefined): number {
  const m = /:(\d+)$/.exec(key ?? "");
  return m ? Number(m[1]) : 0;
}

export function toLayer(w: WireLayer): Layer {
  const pixelsRev = int(w.pixelsRev);
  const maskRev = int(w.maskRev);
  return {
    ...w,
    x: int(w.x),
    y: int(w.y),
    createdAt: int(w.createdAt),
    updatedAt: int(w.updatedAt),
    blobId: pixelsKey(w.id, pixelsRev),
    maskBlobId: maskKey(w.id, maskRev, w.hasMask),
    pixelsRev,
    maskRev,
    hasMask: w.hasMask,
  };
}

function toMember(m: WireMember): Member {
  return { id: m.id, username: m.username, avatar: m.avatar, joinedAt: int(m.joinedAt) };
}

function toExport(e: Omit<Export, "createdAt"> & { createdAt: Int }): Export {
  return { ...e, createdAt: int(e.createdAt) };
}

/** `update_layer` → `updateLayer`, `blob_id` → `blobId`. */
export function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** The camelCase arguments of `method`, with its 64-bit integers as decimal strings. */
export function toWireArgs(method: Method, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) out[camel(k)] = v;
  for (const p of INT_PARAMS[method] ?? []) {
    if (p in out) out[p] = intArg(out[p]);
  }
  if (method === "addLayer" && out.layer && typeof out.layer === "object") {
    const layer: Record<string, unknown> = { ...(out.layer as Record<string, unknown>) };
    for (const k of NOT_NEW_LAYER) delete layer[k];
    for (const k of NEW_LAYER_INTS) layer[k] = intArg(layer[k] ?? 0);
    out.layer = layer;
  }
  return out;
}

type Transport = Pick<CalimeroClient, "call" | "view">;

/** The most pages a whole-list read follows (500 layers, at most 100 rows a page by default). */
const MAX_PAGES = 64;

/**
 * The document at app instance `app`, with v1's method names and answers.
 * `after` runs after every request (the session store syncs a refreshed
 * session there).
 */
export class PixartClient {
  constructor(
    private readonly client: Transport,
    private readonly after: () => void = () => {},
  ) {}

  /** One request, as the node runs it: a view without writing, a call through the log. */
  async raw<T>(app: string, method: Method, args: Record<string, unknown> = {}): Promise<T> {
    try {
      const isView = (VIEWS as readonly string[]).includes(method);
      const res = isView
        ? await this.client.view(app, method, args)
        : await this.client.call(app, method, args);
      return res.result as T;
    } finally {
      this.after();
    }
  }

  /** Every page of a paged view, `next` followed (bounded). */
  async all<T>(app: string, method: View, args: Record<string, unknown> = {}): Promise<T[]> {
    const items: T[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page: Page<T> = await this.raw<Page<T>>(app, method, { ...args, cursor, limit: 500 });
      items.push(...page.items);
      if (!page.next) break;
      cursor = page.next;
    }
    return items;
  }

  /**
   * A v1-style call: `method` and `args` as the screens name them (snake_case
   * or camelCase), the answer in the shape the screens use.
   */
  async call<T>(app: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const name = camel(method) as Method;
    if (!(CALLS as readonly string[]).includes(name) && !(VIEWS as readonly string[]).includes(name)) {
      throw new Error(`MeroPixArt has no method ${method}`);
    }
    const wire = toWireArgs(name, args);
    switch (name) {
      case "getLayers":
        return (await this.all<WireLayer>(app, "getLayers")).map(toLayer) as T;
      case "getLayer": {
        const l = await this.raw<WireLayer | null>(app, "getLayer", wire);
        return (l ? toLayer(l) : null) as T;
      }
      case "getMembers":
        return (await this.all<WireMember>(app, "getMembers")).map(toMember) as T;
      case "listRoles":
        return (await this.all<MemberRole>(app, "listRoles")) as T;
      case "getLayerTiles":
        return (await this.all<Tile>(app, "getLayerTiles", wire)) as T;
      case "getExports": {
        const page = await this.raw<Page<Omit<Export, "createdAt"> & { createdAt: Int }>>(app, "getExports", wire);
        return page.items.map(toExport) as T;
      }
      case "clearLayers": {
        // Batched on the contract (a call removes about 4,096 tiles): repeat
        // until nothing is left.
        let removed = 0;
        for (let i = 0; i < 10_000; i++) {
          const r = await this.raw<{ removed: number; more: boolean }>(app, "clearLayers");
          removed += r.removed;
          if (!r.more) break;
        }
        return removed as T;
      }
      default:
        return this.raw<T>(app, name, wire);
    }
  }

  // ── typed helpers the screens use ──────────────────────────────────────────

  getDocument(app: string): Promise<DocumentInfo> {
    return this.raw(app, "getDocument");
  }

  myRole(app: string): Promise<Role> {
    return this.raw(app, "myRole");
  }

  /** Writes changed tiles of a raster layer's pixels (see `tiles.ts`). */
  async updateLayerContent(app: string, id: string, width: number, height: number, tiles: TileWrite[], updatedAt: number): Promise<void> {
    await this.raw(app, "updateLayerContent", { id, width, height, tiles, updatedAt: intArg(updatedAt) });
  }

  /** Writes changed tiles of a layer's mask; `null` removes the mask. */
  async updateLayerMask(app: string, id: string, tiles: TileWrite[] | null, updatedAt: number): Promise<void> {
    await this.raw(app, "updateLayerMask", { id, tiles, updatedAt: intArg(updatedAt) });
  }

  getLayerTiles(app: string, id: string, mask: boolean): Promise<Tile[]> {
    return this.all<Tile>(app, "getLayerTiles", { id, mask });
  }

  async addExport(app: string, blobId: string, name: string, format: Export["format"]): Promise<string> {
    return this.raw(app, "addExport", { blobId, name, format });
  }

  async getExports(app: string, limit = 50): Promise<Export[]> {
    const page = await this.raw<Page<Omit<Export, "createdAt"> & { createdAt: Int }>>(app, "getExports", { limit });
    return page.items.map(toExport);
  }

  async deleteExport(app: string, id: string): Promise<void> {
    await this.raw(app, "deleteExport", { id });
  }
}
