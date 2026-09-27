// What a routed URL resolves to, so a link into a restricted folder, a
// deleted doc or an unfamiliar workspace shows a card instead of silently
// dropping the user on Home. Pure: every input is a snapshot the caller
// already has, `null` meaning "not loaded yet" so a slow read never reads
// as "gone".

import type { AppRoute } from './routes';
import type { RegistryFolderShape } from '@/hooks/useWorkspaceTree';

export type LinkTarget = 'ok' | 'syncing' | 'no-access' | 'deleted' | 'not-in-workspace';

export interface LinkTargetInput {
  route: AppRoute | null;
  /** Workspace ids this node belongs to; null while that list hasn't loaded. */
  namespaceIds: string[] | null;
  /** Raw registry rows for the routed workspace; null while its folder list hasn't loaded. */
  folderRegistry: RegistryFolderShape[] | null;
  /** Folder ids hidden from this caller — restricted folders it isn't a member of. */
  hiddenFolderIds: Set<string>;
  /** Docs in the routed folder; null while that list hasn't loaded. */
  docs: { id: string }[] | null;
}

export function resolveLinkTarget(input: LinkTargetInput): LinkTarget {
  const { route } = input;
  if (!route) return 'ok';
  if (input.namespaceIds && !input.namespaceIds.includes(route.ws)) {
    return 'not-in-workspace';
  }
  if (!route.folder) return 'ok';
  if (!input.folderRegistry) return 'syncing';
  const folder = input.folderRegistry.find((f) => f.id === route.folder);
  if (!folder) return 'deleted';
  if (input.hiddenFolderIds.has(folder.id)) return 'no-access';
  if (!route.doc) return 'ok';
  if (!input.docs) return 'syncing';
  if (!input.docs.some((d) => d.id === route.doc)) return 'deleted';
  return 'ok';
}
