/**
 * The name to show for a workspace, and where it may come from.
 *
 * # Why there are three sources
 *
 * A workspace name used to live in `localStorage` alone
 * (`setStoredGroupAlias`), which makes it a label on one browser: it does not
 * replicate, so two people in the same workspace see different names and a new
 * device sees a hex id.
 *
 * Core has carried a replicated record for this all along —
 * `GET/PUT /admin-api/groups/:id/metadata`, applied as `GroupOp::GroupMetadataSet`
 * — and `GroupInfo.metadata` is documented as replacing the old `alias` field.
 * Nothing in this app wrote or read it.
 *
 * So metadata is the source of truth, and the other two are compatibility:
 *
 *   1. `metadataName`  — replicated, shared by everyone. Wins.
 *   2. `serverAlias`   — whatever the listing reports, for older nodes.
 *   3. `localAlias`    — this browser's label, from before metadata was used.
 *
 * The local alias must keep working: every workspace named before this shipped
 * has only that, and ignoring it would erase names people already set.
 */
export interface WorkspaceNameSources {
  /** `metadata.name` from the node. Replicated. */
  metadataName: string | null | undefined;
  /** `name`/`alias` from the namespace listing, if the node sends one. */
  serverAlias: string | null | undefined;
  /** This browser's stored label. */
  localAlias: string | null | undefined;
  /** Used only to build a readable stand-in when nothing has named it. */
  groupId: string;
}

const clean = (value: string | null | undefined): string => (value ?? "").trim();

export function resolveWorkspaceName(sources: WorkspaceNameSources): string {
  return (
    clean(sources.metadataName) ||
    clean(sources.serverAlias) ||
    clean(sources.localAlias) ||
    (sources.groupId ? `${sources.groupId.slice(0, 8)}…` : "Workspace")
  );
}

/**
 * Whether a local-only name should be promoted into the shared record.
 *
 * True exactly when this browser knows a name and the workspace does not, which
 * is every workspace named before metadata was used. Promoting it once makes it
 * visible to everyone else; after that `metadataName` answers and this is false.
 */
export function shouldBackfillWorkspaceName(sources: WorkspaceNameSources): boolean {
  return !clean(sources.metadataName) && !!clean(sources.localAlias);
}
