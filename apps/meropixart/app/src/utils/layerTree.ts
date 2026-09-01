// ── Layer tree (folders) ─────────────────────────────────────────────────────
//
// The contract already stores `parentId` on every layer, so the folder hierarchy
// is real state shared by every peer — this module is the shape the UI reads it
// through. The layers panel renders the tree, and selecting a folder row means
// "the folder and everything inside it".
//
// Two things the flat list could not express and this can:
//
//   • collapse — a folder hides its subtree in the panel (view state, per user)
//   • selection — picking a folder picks its whole subtree, so a move drags the
//     contents along with it, which is what "group" means to anyone who has used
//     an image editor before
//
// Replicated state can contain a cycle (two peers each re-parenting into the
// other before they sync), so every walk here is depth-capped and cycle-guarded.
// A malformed tree must degrade to a flat list, never hang the editor.

import type { Layer } from "../types";
import { unionBounds } from "./transform";

/** Deepest nesting the panel will indent to; also the cycle-walk cap. */
const MAX_DEPTH = 32;

export interface TreeNode {
  layer: Layer;
  /** 0 for a top-level row. */
  depth: number;
  /** Children, front-most first (descending layerIndex) — empty for leaves. */
  children: TreeNode[];
}

function byIndexDesc(a: TreeNode, b: TreeNode): number {
  return b.layer.layerIndex - a.layer.layerIndex;
}

/**
 * Build the folder tree, front-most first — the order the panel shows, matching
 * every other editor (top row = top of the stack).
 *
 * A layer whose `parentId` names a layer that does not exist, is not a group, or
 * would close a cycle is treated as top-level. That is the degradation rule: an
 * orphan is always visible somewhere rather than silently dropped.
 */
export function buildTree(layers: Layer[]): TreeNode[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const nodes = new Map<string, TreeNode>();
  for (const l of layers) nodes.set(l.id, { layer: l, depth: 0, children: [] });

  const roots: TreeNode[] = [];
  for (const l of layers) {
    const node = nodes.get(l.id)!;
    const parentId = effectiveParentId(l, byId);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const assignDepth = (list: TreeNode[], depth: number) => {
    list.sort(byIndexDesc);
    for (const n of list) {
      n.depth = depth;
      if (n.children.length > 0) assignDepth(n.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** The parent a layer actually hangs off: null unless it names a real group it
 *  is not an ancestor of. */
function effectiveParentId(layer: Layer, byId: Map<string, Layer>): string | null {
  const parentId = layer.parentId ?? null;
  if (!parentId || parentId === layer.id) return null;
  const parent = byId.get(parentId);
  if (!parent || parent.kind !== "group") return null;
  // Walk up from the parent: meeting ourselves means this edge closes a cycle.
  let cur: Layer | undefined = parent;
  for (let i = 0; i < MAX_DEPTH && cur; i++) {
    if (cur.id === layer.id) return null;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return parentId;
}

/** Flatten a tree to rows, skipping the subtrees of collapsed folders. */
export function visibleRows(
  roots: TreeNode[], collapsed: Record<string, boolean> = {},
): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children.length > 0 && !collapsed[n.layer.id]) walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** Every layer id under `id`, at any depth (excluding `id` itself). */
export function descendantIds(layers: Layer[], id: string): string[] {
  const childrenOf = new Map<string, string[]>();
  const byId = new Map(layers.map((l) => [l.id, l]));
  for (const l of layers) {
    const parentId = effectiveParentId(l, byId);
    if (!parentId) continue;
    const list = childrenOf.get(parentId);
    if (list) list.push(l.id);
    else childrenOf.set(parentId, [l.id]);
  }
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(childrenOf.get(id) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    stack.push(...(childrenOf.get(next) ?? []));
  }
  return out;
}

/** Direct children of a layer, front-most first. */
export function childrenOf(layers: Layer[], id: string): Layer[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  return layers
    .filter((l) => effectiveParentId(l, byId) === id)
    .sort((a, b) => b.layerIndex - a.layerIndex);
}

/** True when `id` sits anywhere under `ancestorId`. */
export function isDescendantOf(layers: Layer[], id: string, ancestorId: string): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur = byId.get(id);
  for (let i = 0; i < MAX_DEPTH && cur; i++) {
    const parentId = effectiveParentId(cur, byId);
    if (!parentId) return false;
    if (parentId === ancestorId) return true;
    cur = byId.get(parentId);
  }
  return false;
}

/** The chain of folder ids above a layer, nearest parent first. */
export function ancestorIds(layers: Layer[], id: string): string[] {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const out: string[] = [];
  let cur = byId.get(id);
  for (let i = 0; i < MAX_DEPTH && cur; i++) {
    const parentId = effectiveParentId(cur, byId);
    if (!parentId) break;
    out.push(parentId);
    cur = byId.get(parentId);
  }
  return out;
}

/**
 * Expand a selection so that picking a folder picks its contents.
 *
 * This is what makes a group behave like one object: the move/delete/transform
 * paths all read the expanded set, so dragging a folder row on the canvas drags
 * every layer inside it and nothing else. Order is preserved and the primary
 * (last) id stays last, because the primary layer drives the properties panel.
 */
export function expandSelection(layers: Layer[], ids: string[]): string[] {
  const known = new Set(layers.map((l) => l.id));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (id: string) => {
    if (!known.has(id) || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };
  for (const id of ids) {
    for (const child of descendantIds(layers, id)) push(child);
    push(id); // the folder itself last, so it stays the primary selection
  }
  return out;
}

/** The layers a move should translate: the selection, folder contents included,
 *  minus anything locked. Folders have no pixels of their own, so they move by
 *  their `x`/`y` alone — the children carry the picture. */
export function movableLayers(layers: Layer[], selectedIds: string[]): Layer[] {
  const ids = new Set(expandSelection(layers, selectedIds));
  return layers.filter((l) => ids.has(l.id) && !l.locked);
}

/** Bounding box of a folder in document space: the union of its contents'
 *  bounds. A folder with no contents falls back to its own box, so a fresh
 *  empty group still shows a gizmo. */
export function groupBounds(layers: Layer[], id: string): { x: number; y: number; w: number; h: number } {
  const ids = new Set(descendantIds(layers, id));
  const contents = layers.filter((l) => ids.has(l.id) && l.kind !== "group");
  if (contents.length > 0) return unionBounds(contents);
  const self = layers.find((l) => l.id === id);
  return self ? unionBounds([self]) : { x: 0, y: 0, w: 0, h: 0 };
}

/** "Group 1", "Group 2", … — the first name not already taken by a group. */
export function nextGroupName(layers: Layer[], base = "Group"): string {
  const taken = new Set(
    layers.filter((l) => l.kind === "group").map((l) => l.name.trim().toLowerCase()),
  );
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Where a new group should be created for `ids`: the folder they already share,
 * so grouping two layers that both live in "Header" nests the new group inside
 * "Header" instead of yanking them out to the root.
 */
export function commonParentId(layers: Layer[], ids: string[]): string | null {
  if (ids.length === 0) return null;
  const chainOf = (id: string) => [...ancestorIds(layers, id)].reverse(); // root → nearest
  let common = chainOf(ids[0]);
  for (const id of ids.slice(1)) {
    const chain = chainOf(id);
    let i = 0;
    while (i < common.length && i < chain.length && common[i] === chain[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) break;
  }
  return common.length > 0 ? common[common.length - 1] : null;
}

/**
 * The ids that should actually be re-parented when grouping a selection: drop
 * any layer whose own ancestor is also selected, since it travels with it. Also
 * drops ids the caller made up.
 */
export function topmostSelected(layers: Layer[], ids: string[]): string[] {
  const known = new Set(layers.map((l) => l.id));
  const set = new Set(ids.filter((id) => known.has(id)));
  return [...set].filter((id) => !ancestorIds(layers, id).some((a) => set.has(a)));
}

/** Effective visibility: a layer inside a hidden folder is hidden. */
export function isEffectivelyVisible(layers: Layer[], id: string): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const self = byId.get(id);
  if (!self) return false;
  if (!self.visible) return false;
  return ancestorIds(layers, id).every((a) => byId.get(a)?.visible !== false);
}

/** Effective lock: a layer inside a locked folder cannot be edited either. */
export function isEffectivelyLocked(layers: Layer[], id: string): boolean {
  const byId = new Map(layers.map((l) => [l.id, l]));
  const self = byId.get(id);
  if (!self) return false;
  if (self.locked) return true;
  return ancestorIds(layers, id).some((a) => byId.get(a)?.locked === true);
}

/** A count for the folder row: how many layers are inside, at any depth. */
export function contentCount(layers: Layer[], id: string): number {
  return descendantIds(layers, id).length;
}
