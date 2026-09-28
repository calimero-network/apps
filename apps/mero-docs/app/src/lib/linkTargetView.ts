import {
  rowKey,
  type DocHrefTarget,
  type IndexRow,
} from './workspaceIndex/types';

export type DocLinkCardState =
  | { state: 'other-workspace' }
  | { state: 'no-access' }
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'deleted' }
  | { state: 'ok'; row: IndexRow };

/** Null sets are not known yet. */
export type DocLinkCardContext = {
  ws: string | null;
  existingFolders: ReadonlySet<string> | null; // every folder in the workspace registry
  readableFolders: ReadonlySet<string> | null; // folders this member can open
  failedFolders: ReadonlySet<string>; // folders whose doc list could not be read
  loadedFolders: ReadonlySet<string>;
  rows: ReadonlyMap<string, IndexRow>; // keyed by rowKey
};

/** What a doc link's hover card shows, in resolveLinkTarget's order; nothing unknown reads as deleted. */
export function docLinkCardState(
  target: DocHrefTarget,
  ctx: DocLinkCardContext,
): DocLinkCardState {
  if (ctx.ws === null) return { state: 'loading' };
  if (target.ws !== ctx.ws) return { state: 'other-workspace' };
  if (!ctx.existingFolders) return { state: 'loading' };
  if (!ctx.existingFolders.has(target.folder)) return { state: 'deleted' };
  if (!ctx.readableFolders) return { state: 'loading' };
  if (!ctx.readableFolders.has(target.folder)) return { state: 'no-access' };
  if (ctx.failedFolders.has(target.folder)) return { state: 'unavailable' };
  if (!ctx.loadedFolders.has(target.folder)) return { state: 'loading' };
  const row = ctx.rows.get(rowKey(target.folder, target.doc));
  return row ? { state: 'ok', row } : { state: 'deleted' };
}
