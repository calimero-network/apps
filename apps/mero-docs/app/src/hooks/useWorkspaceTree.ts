// The folder shape the workspace hands its consumers. The folders themselves
// are read from core (lib/coreFolders); this module only names their shape.

export interface MergedFolder {
  id: string;
  parent_id: string | null;
  alias: string;
  /** Core's GroupInfo.subgroupVisibility; `undefined` when core gave none. */
  visibility: 'Open' | 'Restricted' | undefined;
  color: string | null;
  /** Reached through a context this node holds rather than through the
   *  tree: the caller cannot see the folder above it. */
  shared?: boolean;
}
