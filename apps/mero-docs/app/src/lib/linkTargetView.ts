import {
  rowKey,
  type DocHrefTarget,
  type IndexRow,
} from './workspaceIndex/types';

export type DocLinkCard =
  | { kind: 'other-workspace' }
  | { kind: 'no-access' }
  | { kind: 'loading' }
  | { kind: 'deleted' }
  | { kind: 'ok'; row: IndexRow };

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
): DocLinkCard {
  if (target.ws !== ctx.ws) return { kind: 'other-workspace' };
  if (!ctx.readableFolders.has(target.folder)) return { kind: 'no-access' };
  if (!ctx.loadedFolders.has(target.folder)) return { kind: 'loading' };
  const row = ctx.rows.get(rowKey(target.folder, target.doc));
  return row ? { kind: 'ok', row } : { kind: 'deleted' };
}
