// Whether a folder is closed to the rest of the workspace.
//
// A folder's own visibility says how it takes members: an Open folder takes
// its parent's, a Restricted one only those added to it. Who else can reach it
// is decided by the whole chain: an Open folder inside a Restricted one takes
// that folder's members and nobody else's, so it is as private as its parent.
// Core reports this as `effectiveVisibility`; a node that predates it leaves
// it out, and the tree this caller sees answers the same question.

export interface RestrictionInput {
  id: string;
  parent_id: string | null;
  visibility: 'Open' | 'Restricted' | undefined;
  /** Reached with no visible parent: something above it is Restricted. */
  shared?: boolean;
  /** Core's answer, when the node gives one. */
  effectiveVisibility?: 'Open' | 'Restricted';
}

export interface Restriction {
  restricted: boolean;
  /** The nearest Restricted folder at or above this one that the caller sees;
   *  null when it is not restricted, or the wall is above what it can see. */
  by: string | null;
}

const OPEN: Restriction = { restricted: false, by: null };

export function restrictionOf(folders: RestrictionInput[]): Map<string, Restriction> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out = new Map<string, Restriction>();

  const resolve = (id: string, depth: number): Restriction => {
    const known = out.get(id);
    if (known) return known;
    const f = byId.get(id);
    // A parent outside the visible tree, or a cycle: closed, wall unseen.
    if (!f || depth > folders.length) return { restricted: true, by: null };
    let r: Restriction;
    if (f.visibility === 'Restricted') r = { restricted: true, by: f.id };
    else if (f.parent_id) r = resolve(f.parent_id, depth + 1);
    else if (f.shared) r = { restricted: true, by: null };
    else r = OPEN;
    // Core's answer wins on whether; the tree still names the wall.
    if (f.effectiveVisibility) {
      r = f.effectiveVisibility === 'Restricted' ? { restricted: true, by: r.by } : OPEN;
    }
    out.set(id, r);
    return r;
  };

  for (const f of folders) resolve(f.id, 0);
  return out;
}

/** Who an Open folder lets in, for copy: the workspace, or the members of the
 *  Restricted folder it sits in. */
export function openAudience(
  folder: { restricted?: boolean; restrictedBy?: string | null } | undefined,
  labelOf: (id: string) => string | undefined,
): string {
  if (!folder?.restricted) return 'all workspace members';
  const wall = folder.restrictedBy ? labelOf(folder.restrictedBy) : undefined;
  return wall ? `members of ${wall}` : 'members of the folder above';
}
