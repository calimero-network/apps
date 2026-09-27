import {
  rowKey,
  type DocHrefTarget,
  type IndexRow,
} from './workspaceIndex/types';

export type DocLinkCardState =
  | { state: 'other-workspace' }
  | { state: 'no-access' }
  | { state: 'loading' }
  | { state: 'deleted' }
  | { state: 'ok'; row: IndexRow };

export type DocLinkCardContext = {
  ws: string;
  readableFolders: ReadonlySet<string>;
  loadedFolders: ReadonlySet<string>;
  rows: ReadonlyMap<string, IndexRow>; // keyed by rowKey
};

/** What a doc link's hover card shows; a folder still loading never reads as deleted. */
export function docLinkCardState(
  target: DocHrefTarget,
  ctx: DocLinkCardContext,
): DocLinkCardState {
  if (target.ws !== ctx.ws) return { state: 'other-workspace' };
  if (!ctx.readableFolders.has(target.folder)) return { state: 'no-access' };
  if (!ctx.loadedFolders.has(target.folder)) return { state: 'loading' };
  const row = ctx.rows.get(rowKey(target.folder, target.doc));
  return row ? { state: 'ok', row } : { state: 'deleted' };
}
