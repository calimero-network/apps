// Which loading stage the workspace is in — extracted from `useDriveWorkspace`
// so the one rule that matters here can actually be asserted.
//
// ⚠️ THE RULE: A BACKGROUND REFRESH MUST NOT REACH A LOADING STAGE.
//
// `FolderTree` renders a single "Loading folders…" line whenever the workspace
// reports `loading`, which unmounts the entire `<ul>` and every row in it. And
// mero-react's `useAsyncResource.refetch` calls `setLoading(true)` on EVERY
// refetch — so an SSE ding, which refetches the whole workspace, flipped
// `regLoading` / `subLoading` / `contextsLoading` true a few times a minute and
// the sidebar was torn down and rebuilt each time. That is the flicker.
//
// It could not be fixed in the data layer, and the data layer had already
// tried: `loadRegFolders` deliberately returns the PREVIOUS array when the
// fetched content is unchanged, precisely so the tree keeps its identity. The
// view unmounted anyway, because it was asked to.
//
// So a stage that hides content is only reachable before the FIRST load for a
// namespace completes. After that a refresh keeps the rendered rows and swaps
// the data underneath them — which is also the honest answer, because during a
// background refresh the app does know what the folders are.

export type DriveLoadingStage =
  | 'idle'
  | 'awaiting-auth'
  | 'resolving-namespaces'
  | 'resolving-registry-context'
  | 'loading-subgroups'
  | 'loading-folders'
  | 'syncing-from-peers'
  | 'ready';

export interface StageInput {
  authLoading: boolean;
  appIdResolving: boolean;
  isAuthenticated: boolean;
  hasApplicationId: boolean;
  nsLoading: boolean;
  hasSelectedNamespace: boolean;
  /** The registry context id is resolved (possibly from the sticky value). */
  hasRegistryContext: boolean;
  membersLoading: boolean;
  identityLoading: boolean;
  hasSelfIdentity: boolean;
  subLoading: boolean;
  regLoading: boolean;
  /**
   * A clean folder load has completed for the ACTIVE namespace at least once.
   * This is the whole flicker fix: it turns every subsequent `*Loading`
   * pulse into a background refresh rather than a teardown.
   */
  hasLoadedFoldersForNs: boolean;
  /** Folders exist but none has been resolved by the access fan-out yet. */
  awaitingFirstFolderResolve: boolean;
  isJustJoined: boolean;
}

export function deriveDriveStage(i: StageInput): DriveLoadingStage {
  if (i.authLoading) return 'awaiting-auth';
  if (i.appIdResolving) return 'awaiting-auth';
  if (!i.isAuthenticated || !i.hasApplicationId) return 'awaiting-auth';
  // Every `*Loading` flag pulses on refetch, so each may only gate the first
  // load; a missing value (context, identity) still gates at any time.
  const firstLoad = !i.hasLoadedFoldersForNs;
  if (i.nsLoading && firstLoad) return 'resolving-namespaces';
  if (!i.hasSelectedNamespace) return 'idle';
  // ⚠️ No `contextsLoading` here. It pulses on every refetch, and the registry
  // id is held sticky across an in-flight read precisely so this branch does
  // not fire for a workspace we have already resolved.
  if (
    !i.hasRegistryContext ||
    !i.hasSelfIdentity ||
    (firstLoad && (i.membersLoading || i.identityLoading))
  ) {
    return i.isJustJoined ? 'syncing-from-peers' : 'resolving-registry-context';
  }
  if (i.subLoading && firstLoad) return 'loading-subgroups';
  if (i.regLoading && firstLoad) return 'loading-folders';
  if (i.awaitingFirstFolderResolve) return 'loading-folders';
  if (i.isJustJoined && firstLoad) return 'syncing-from-peers';
  return 'ready';
}

/** Whether this stage hides the workspace content behind a placeholder. */
export function stageHidesContent(stage: DriveLoadingStage): boolean {
  return stage !== 'ready' && stage !== 'idle';
}
