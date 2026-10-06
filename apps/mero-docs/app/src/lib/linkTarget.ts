// What a routed URL resolves to: open it, wait, or show why it can't. Pure;
// `null` inputs mean "not loaded yet" so a slow read never reads as "gone".

import type { AppRoute } from './routes';

export type LinkTarget = 'ok' | 'syncing' | 'no-access' | 'deleted' | 'not-in-workspace';

export interface LinkTargetInput {
  route: AppRoute | null;
  /** True while the route's workspace is a fresh join not yet listed. */
  justJoinedWorkspace: boolean;
  /** Workspace ids this node belongs to; null while that list hasn't loaded. */
  namespaceIds: string[] | null;
  /** Raw registry rows for the routed workspace; null while its folder list hasn't loaded. */
  folderRegistry: { id: string }[] | null;
  /** Folder ids whose access this caller has resolved; hiddenFolderIds is only trustworthy for these. */
  resolvedFolderIds: Set<string>;
  /** Folder ids hidden from this caller: restricted folders it isn't a member of. */
  hiddenFolderIds: Set<string>;
  /** Docs in the routed folder (archived included, for existence); null while not yet loaded. */
  docs: { id: string }[] | null;
}

export function resolveLinkTarget(input: LinkTargetInput): LinkTarget {
  const { route } = input;
  if (!route) return 'ok';
  if (input.justJoinedWorkspace) return 'syncing';
  if (input.namespaceIds && !input.namespaceIds.includes(route.ws)) {
    return 'not-in-workspace';
  }
  if (!route.folder) return 'ok';
  if (!input.folderRegistry) return 'syncing';
  const folder = input.folderRegistry.find((f) => f.id === route.folder);
  if (!folder) return 'deleted';
  if (!input.resolvedFolderIds.has(folder.id)) return 'syncing';
  if (input.hiddenFolderIds.has(folder.id)) return 'no-access';
  if (!route.doc) return 'ok';
  if (!input.docs) return 'syncing';
  if (!input.docs.some((d) => d.id === route.doc)) return 'deleted';
  return 'ok';
}
