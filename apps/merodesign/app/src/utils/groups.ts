import type { Element } from "../types";

/**
 * Groups and frames, built on the element `label` that already exists in the
 * contract.
 *
 * The board arrives as a flat list of up to a few hundred elements — the bundled
 * starter is 470 — and the layers panel used to render every one of them as
 * "rect" / "text", unordered and unnamed. Figma's answer is a tree, so this is a
 * tree: a label is a `/`-separated path, everything before the last segment is
 * the group it lives in, and the last segment is its own name.
 *
 *   "screen/01 Sign in"  →  group "screen",  name "01 Sign in"
 *   "topbar/logo"        →  group "topbar",  name "logo"
 *   "rule"               →  root,            name "rule"
 *
 * That is the shape the starter project was already authored in, so the
 * hierarchy appears on existing boards with no migration. It also means group
 * membership travels through `update_element_label`, a contract method that
 * exists today — no new WASM, no state-layout change, and every peer sees the
 * same grouping because it lives in contract state rather than local storage.
 *
 * The cost of the choice: a group is a naming convention, not an entity, so an
 * empty group cannot exist (it has no members to carry its name) and `/` is
 * reserved inside a name. `sanitizeName` enforces the second part.
 */

export const GROUP_SEP = "/";

export interface ElementNode {
  kind: "element";
  /** Element id. */
  id: string;
  /** Last path segment, or a derived name when the element has no label. */
  name: string;
  /** Full label path, "" when unlabelled. */
  path: string;
  element: Element;
  /** Paint order; higher is nearer the front. */
  layerIndex: number;
}

export interface GroupNode {
  kind: "group";
  /** Full path of this group, e.g. "screen" or "topbar/actions". */
  path: string;
  /** Last segment of `path`. */
  name: string;
  children: LayerNode[];
  /** Every element id under this group, at any depth. */
  elementIds: string[];
  /** Front-most member, so a group sorts against its siblings by paint order. */
  layerIndex: number;
}

export type LayerNode = ElementNode | GroupNode;

/** A label is a path; empty segments are dropped so "a//b" and "/a" behave. */
export function splitPath(label: string | null | undefined): string[] {
  return (label ?? "")
    .split(GROUP_SEP)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function joinPath(segments: string[]): string {
  return segments.filter((s) => s.length > 0).join(GROUP_SEP);
}

/** Everything before the last segment: the group an element belongs to. */
export function groupPathOf(label: string | null | undefined): string {
  return joinPath(splitPath(label).slice(0, -1));
}

/** The parent of a group path. "a/b/c" → "a/b"; "a" → "". */
export function parentPathOf(path: string): string {
  return joinPath(splitPath(path).slice(0, -1));
}

/** `/` is the separator, so it can never appear inside one name. */
export function sanitizeName(name: string): string {
  return name.replace(new RegExp(GROUP_SEP, "g"), "-").trim();
}

/**
 * What to call an element that was never named. A text layer says what it says —
 * that is what Figma shows, and it is the difference between 306 layers called
 * "text" and 306 layers you can find.
 */
export function derivedName(el: Element): string {
  if (el.data.kind === "text") {
    const content = (el.data.content ?? "").replace(/\s+/g, " ").trim();
    if (content) return content.length > 28 ? content.slice(0, 27) + "…" : content;
  }
  return el.data.kind;
}

/** The name shown in the layers tree: last label segment, else derived. */
export function nameOf(el: Element, override?: string): string {
  if (override && override.trim()) return override.trim();
  const segments = splitPath(el.label);
  return segments.length > 0 ? segments[segments.length - 1] : derivedName(el);
}

/** The label an element should carry to sit in `groupPath` under `name`. */
export function labelFor(groupPath: string, name: string): string {
  return joinPath([...splitPath(groupPath), sanitizeName(name)]);
}

/** True when `path` is `ancestor` itself or nested inside it. */
export function isUnder(path: string, ancestor: string): boolean {
  if (!ancestor) return true;
  return path === ancestor || path.startsWith(ancestor + GROUP_SEP);
}

/**
 * Builds the layers tree. Elements sort front-to-back (the order the panel shows
 * and Figma shows), and a group sorts by its front-most member so it does not
 * jump around as its contents change.
 *
 * `labelOverrides` is the local rename cache, applied on top of contract labels
 * so a rename shows immediately rather than after the RPC round-trips.
 */
export function buildLayerTree(
  elements: Element[],
  labelOverrides: Record<string, string> = {},
): LayerNode[] {
  const root: LayerNode[] = [];
  // Group path → node, so nested groups are created once and reused.
  const groups = new Map<string, GroupNode>();

  function ensureGroup(path: string): GroupNode {
    const existing = groups.get(path);
    if (existing) return existing;
    const segments = splitPath(path);
    const node: GroupNode = {
      kind: "group",
      path,
      name: segments[segments.length - 1] ?? path,
      children: [],
      elementIds: [],
      layerIndex: -Infinity,
    };
    groups.set(path, node);
    const parentPath = parentPathOf(path);
    if (parentPath) ensureGroup(parentPath).children.push(node);
    else root.push(node);
    return node;
  }

  for (const el of elements) {
    const override = labelOverrides[el.id];
    const label = override ?? el.label ?? "";
    const groupPath = groupPathOf(label);
    const node: ElementNode = {
      kind: "element",
      id: el.id,
      name: nameOf(el, override ? splitPath(override).slice(-1)[0] : undefined),
      path: label,
      element: el,
      layerIndex: el.layerIndex,
    };
    if (!groupPath) {
      root.push(node);
      continue;
    }
    const group = ensureGroup(groupPath);
    group.children.push(node);
    // Every ancestor owns this element too, so "select group" grabs the subtree.
    for (let p: string = groupPath; p; p = parentPathOf(p)) {
      const g = groups.get(p);
      if (g) {
        g.elementIds.push(el.id);
        g.layerIndex = Math.max(g.layerIndex, el.layerIndex);
      }
    }
  }

  const byLayerDesc = (a: LayerNode, b: LayerNode) => b.layerIndex - a.layerIndex;
  function sortTree(nodes: LayerNode[]) {
    nodes.sort(byLayerDesc);
    for (const n of nodes) if (n.kind === "group") sortTree(n.children);
  }
  sortTree(root);
  return root;
}

/** Flattens a subtree to element ids, front-most first. */
export function elementIdsOf(node: LayerNode): string[] {
  return node.kind === "element" ? [node.id] : [...node.elementIds];
}

/**
 * The deepest group every one of these elements already sits in. A new group is
 * created there, so grouping two items inside "screen" does not yank them out to
 * the root.
 */
export function commonGroupPath(elements: Element[]): string {
  if (elements.length === 0) return "";
  let common = splitPath(groupPathOf(elements[0].label));
  for (const el of elements.slice(1)) {
    const segments = splitPath(groupPathOf(el.label));
    let i = 0;
    while (i < common.length && i < segments.length && common[i] === segments[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) break;
  }
  return joinPath(common);
}

/** "Group 1", "Group 2", … — the first name free among `siblings`. */
export function uniqueGroupName(siblings: string[], base = "Group"): string {
  const taken = new Set(siblings.map((s) => s.toLowerCase()));
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Every group path that exists directly under `parentPath`. */
export function siblingGroupNames(elements: Element[], parentPath: string): string[] {
  const names = new Set<string>();
  const depth = splitPath(parentPath).length;
  for (const el of elements) {
    const segments = splitPath(groupPathOf(el.label));
    if (segments.length <= depth) continue;
    if (joinPath(segments.slice(0, depth)) !== parentPath) continue;
    names.add(segments[depth]);
  }
  return [...names];
}

/** id → new label. Only elements whose label actually changes are returned. */
export type LabelPatch = Record<string, string>;

/**
 * Moves `ids` into a new group called `name`, created inside the deepest group
 * they already share. Each element keeps its own name and any nesting it had
 * below that shared group.
 */
export function groupElements(elements: Element[], ids: string[], name: string): LabelPatch {
  const idSet = new Set(ids);
  const selected = elements.filter((e) => idSet.has(e.id));
  if (selected.length === 0) return {};
  const base = commonGroupPath(selected);
  const groupPath = joinPath([...splitPath(base), sanitizeName(name)]);
  const patch: LabelPatch = {};
  for (const el of selected) {
    const label = el.label ?? "";
    const segments = splitPath(label);
    // Drop the shared prefix, keep whatever nesting and name follow it.
    const relative = segments.slice(splitPath(base).length);
    const leaf = relative.length > 0 ? relative : [derivedName(el)];
    const next = joinPath([...splitPath(groupPath), ...leaf]);
    if (next !== label) patch[el.id] = next;
  }
  return patch;
}

/**
 * Dissolves one group: every member moves up to the group's parent, keeping its
 * own name and any nesting below the group.
 */
export function ungroupPath(elements: Element[], groupPath: string): LabelPatch {
  if (!groupPath) return {};
  const parent = parentPathOf(groupPath);
  const depth = splitPath(groupPath).length;
  const patch: LabelPatch = {};
  for (const el of elements) {
    const label = el.label ?? "";
    // The element's GROUP must be under this path — an element merely *named*
    // "screen" is a leaf at the root, not a member of the group "screen", and
    // dissolving that group must not blank its label.
    if (!isUnder(groupPathOf(label), groupPath)) continue;
    const segments = splitPath(label);
    const next = joinPath([...splitPath(parent), ...segments.slice(depth)]);
    if (next !== label) patch[el.id] = next;
  }
  return patch;
}

/** Renames a group in place, moving every descendant with it. */
export function renameGroup(elements: Element[], groupPath: string, newName: string): LabelPatch {
  const clean = sanitizeName(newName);
  if (!groupPath || !clean) return {};
  const parent = parentPathOf(groupPath);
  const nextPath = joinPath([...splitPath(parent), clean]);
  if (nextPath === groupPath) return {};
  const depth = splitPath(groupPath).length;
  const patch: LabelPatch = {};
  for (const el of elements) {
    // Same rule as ungroupPath: membership is decided by the group path, never
    // by an element that happens to share the group's name.
    if (!isUnder(groupPathOf(el.label), groupPath)) continue;
    const segments = splitPath(el.label);
    patch[el.id] = joinPath([...splitPath(nextPath), ...segments.slice(depth)]);
  }
  return patch;
}

/** Renames one element, leaving the group it sits in alone. */
export function renameElement(el: Element, newName: string): string {
  return labelFor(groupPathOf(el.label), newName || derivedName(el));
}
