// Pure tree helpers over a flat `{ id, parent_id }` folder list, used by
// permission hooks (walk root-ward for cap inheritance) and the folder
// tree renderer (walk leaf-first for cascade delete). No network / no
// admin-API access — the caller hands us the materialised list.

export interface FolderLite {
  id: string;
  parent_id: string | null;
}

export interface TreeNode {
  id: string;
  children: TreeNode[];
}

export interface Tree {
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
}

export function buildTree(folders: FolderLite[]): Tree {
  const byId = new Map<string, TreeNode>();
  for (const f of folders) byId.set(f.id, { id: f.id, children: [] });
  const roots: TreeNode[] = [];
  for (const f of folders) {
    const node = byId.get(f.id)!;
    if (f.parent_id && byId.has(f.parent_id)) {
      byId.get(f.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return { roots, byId };
}

// Returns [] on a cycle — a corrupted group graph from admin-API must
// not hang the UI. Better to show a folder as detached than spin forever.
export function ancestorsOf(folders: FolderLite[], id: string): string[] {
  const map = new Map(folders.map((f) => [f.id, f.parent_id]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = map.get(id) ?? null;
  while (cur) {
    if (seen.has(cur)) return [];
    seen.add(cur);
    out.push(cur);
    cur = map.get(cur) ?? null;
  }
  return out;
}

export function descendantsOf(folders: FolderLite[], id: string): string[] {
  const children = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const arr = children.get(f.parent_id) ?? [];
    arr.push(f.id);
    children.set(f.parent_id, arr);
  }
  const out: string[] = [];
  const walk = (n: string) => {
    for (const c of children.get(n) ?? []) walk(c);
    if (n !== id) out.push(n);
  };
  walk(id);
  return out;
}

export function depthOf(folders: FolderLite[], id: string): number {
  return ancestorsOf(folders, id).length;
}
