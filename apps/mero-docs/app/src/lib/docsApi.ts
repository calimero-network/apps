// The contract's methods, typed, over mero-js 28's CalimeroClient.
//
// Replaces the abi-codegen clients v1 generated from the two services'
// ABIs (`src/generated/{docs,registry}`). The method names, argument objects
// and results keep the shapes those clients had, so the hooks reading them did
// not change; this file does the conversion to and from the component's wire:
//
// - method and argument names are camelCase (`list_docs { include_archived }`
//   → `listDocs { includeArchived }`), results' fields too;
// - 64-bit integers arrive as decimal strings, and timestamps in milliseconds
//   where v1 used nanoseconds: `created_at` / `updated_at` are converted back;
// - a read is a `view`, a write a `call` (logged, answered with its result);
// - one component serves both kinds of instance: a folder's docs instance
//   (`DocsClient`) and a workspace's registry instance (`RegistryClient`).
//
// `docsApi.test.ts` checks the method lists and parameter names against the
// committed `logic/res/abi.json`.

import type { CalimeroClient } from '@calimero-network/mero-js';

// ---------------------------------------------------------------- shapes

export interface Run {
  replica: string;
  counter: number;
  len: number;
}

export interface Span {
  text: string;
  attributes: Record<string, string>;
}

export interface Block {
  id: string;
  kind: string;
  depth: number;
  attrs: Record<string, string>;
  spans: Span[];
  ids: Run[];
}

export interface Applied {
  applied: boolean;
  token: string | null;
  spans: Span[];
  anchor: string | null;
  anchor_pos: number | null;
  ids: Run[];
}

export interface TitleApplied {
  applied: boolean;
  token: string | null;
  text: string;
  anchor: string | null;
  anchor_pos: number | null;
  ids: Run[];
}

export interface TitleState {
  text: string;
  ids: Run[];
}

export type Change = Change_Retain | Change_Insert | Change_Delete;
export interface Change_Delete {
  delete: number;
}
export interface Change_Insert {
  insert: string;
  attributes: Record<string, string> | null;
}
export interface Change_Retain {
  retain: number;
  attributes: Record<string, string> | null;
}

/** A document as v1's `DocDto`: timestamps in nanoseconds. */
export interface DocDto {
  id: string;
  title: string;
  tags: string[];
  archived: boolean;
  created_at: number;
  updated_at: number;
  created_by: string;
  updated_by: string;
  can_delete: boolean;
}

export interface CommentDto {
  id: string;
  author: string;
  doc_id: string;
  body: string;
  created_at: number;
}

export interface DocSearchHit {
  id: string;
  title: string;
  snippet: string;
  score: number;
  archived: boolean;
}

export interface DocSearchPage {
  hits: DocSearchHit[];
  total: number;
  next_cursor: number | null;
}

export interface TagDto {
  key: string;
  name: string;
  color: string;
  deleted: boolean;
}

export interface ViewDto {
  id: string;
  name: string;
  query: string;
  created_by: string;
}

// ---------------------------------------------------------------- wire

type Transport = Pick<CalimeroClient, 'call' | 'view'>;

/** Milliseconds (a decimal string) as v1's nanoseconds. */
export function msToNs(ms: unknown): number {
  const n = typeof ms === 'string' ? Number(ms) : typeof ms === 'number' ? ms : 0;
  return Number.isFinite(n) ? n * 1_000_000 : 0;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

function docOf(raw: unknown): DocDto {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(d.id ?? ''),
    title: String(d.title ?? ''),
    tags: Array.isArray(d.tags) ? (d.tags as string[]) : [],
    archived: d.archived === true,
    created_at: msToNs(d.createdAt),
    updated_at: msToNs(d.updatedAt),
    created_by: String(d.createdBy ?? ''),
    updated_by: String(d.updatedBy ?? ''),
    can_delete: d.canDelete === true,
  };
}

function commentOf(raw: unknown): CommentDto {
  const c = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(c.id ?? ''),
    author: String(c.author ?? ''),
    doc_id: String(c.docId ?? ''),
    body: String(c.body ?? ''),
    created_at: msToNs(c.createdAt),
  };
}

function appliedOf<T extends { anchorPos?: number | null }>(raw: T): Omit<T, 'anchorPos'> & { anchor_pos: number | null } {
  const { anchorPos, ...rest } = raw;
  return { ...rest, anchor_pos: anchorPos ?? null };
}

/** Change steps as the contract takes them: `attributes` only where one was given. */
function opsOf(ops: Change[]): unknown[] {
  return ops.map((op) => {
    if ('delete' in op) return { delete: op.delete };
    const { attributes, ...rest } = op as Change_Insert & Change_Retain;
    return attributes == null ? rest : { ...rest, attributes };
  });
}

abstract class Instance {
  protected readonly transport: Transport;

  constructor(
    client: Transport | { client: Transport },
    protected readonly appId: string,
  ) {
    this.transport = 'client' in client ? client.client : client;
  }

  protected async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.transport.view(this.appId, method, args)).result as T;
  }

  protected async call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return (await this.transport.call(this.appId, method, args)).result as T;
  }

  /**
   * Every item of a paged view (`{ items, next }`), following `next` page by
   * page. The contract answers one page per call; the screens take whole lists.
   */
  protected async all<T>(method: string, args: Record<string, unknown> = {}, limit = MAX_PAGE): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: Paged<T> | null = await this.view<Paged<T>>(method, { ...args, cursor, limit });
      out.push(...(page?.items ?? []));
      if (!page?.next) return out;
      cursor = page.next;
    }
  }
}

/** One page of a list view. */
export interface Paged<T> {
  items: T[];
  next: string | null;
}

/** The largest page a list view returns (`getDocument` takes at most {@link MAX_BLOCK_PAGE}). */
export const MAX_PAGE = 1000;
/** The largest page of `getDocument`: each block carries its text. */
export const MAX_BLOCK_PAGE = 200;

// ---------------------------------------------------------------- docs

/** A folder's docs instance. */
export class DocsClient extends Instance {
  // documents
  createDoc(p: { title: string }): Promise<string> {
    return this.call('createDoc', p);
  }
  async getDoc(p: { id: string }): Promise<DocDto> {
    return docOf(await this.view('getDoc', p));
  }
  async listDocs(p: { include_archived: boolean }): Promise<DocDto[]> {
    const rows = await this.all<unknown>('listDocs', { includeArchived: p.include_archived });
    return rows.map(docOf);
  }
  async searchDocs(p: {
    query: string;
    include_archived: boolean;
    cursor: number | null;
    limit: number | null;
  }): Promise<DocSearchPage> {
    const page = await this.view<{ hits?: DocSearchHit[]; total?: unknown; nextCursor?: number | null }>(
      'searchDocs',
      { query: p.query, includeArchived: p.include_archived, cursor: p.cursor, limit: p.limit },
    );
    return { hits: page?.hits ?? [], total: num(page?.total), next_cursor: page?.nextCursor ?? null };
  }
  async editDoc(p: { id: string; title: string }): Promise<void> {
    await this.call('editDoc', p);
  }
  async archiveDoc(p: { id: string }): Promise<void> {
    await this.call('archiveDoc', p);
  }
  async unarchiveDoc(p: { id: string }): Promise<void> {
    await this.call('unarchiveDoc', p);
  }
  async deleteDoc(p: { id: string }): Promise<void> {
    await this.call('deleteDoc', p);
  }
  async addTag(p: { id: string; tag: string }): Promise<void> {
    await this.call('addTag', p);
  }
  async removeTag(p: { id: string; tag: string }): Promise<void> {
    await this.call('removeTag', p);
  }

  // title
  getTitle(p: { doc: string }): Promise<string> {
    return this.view('getTitle', p);
  }
  getTitleState(p: { doc: string }): Promise<TitleState> {
    return this.view('getTitleState', p);
  }
  titleApplyDelta(p: { doc: string; ops: Change[] }): Promise<string> {
    return this.call('titleApplyDelta', { doc: p.doc, ops: opsOf(p.ops) });
  }
  async titleApplyDeltaOn(p: {
    doc: string;
    base: string;
    ops: Change[];
    anchor: string | null;
  }): Promise<TitleApplied> {
    const raw = await this.call<TitleApplied & { anchorPos?: number | null }>('titleApplyDeltaOn', {
      doc: p.doc,
      base: p.base,
      ops: opsOf(p.ops),
      anchor: p.anchor,
    });
    return appliedOf(raw) as TitleApplied;
  }
  titleUndo(p: { doc: string; token: string }): Promise<string> {
    return this.call('titleUndo', p);
  }
  titleAnchorAt(p: { doc: string; position: number; before: boolean }): Promise<string> {
    return this.view('titleAnchorAt', p);
  }
  titleResolve(p: { doc: string; anchors: string[] }): Promise<Array<number | null>> {
    return this.view('titleResolve', p);
  }

  // body structure
  insertBlock(p: { doc: string; after: string | null; kind: string; depth: number }): Promise<string> {
    return this.call('insertBlock', p);
  }
  async deleteBlock(p: { doc: string; block: string }): Promise<void> {
    await this.call('deleteBlock', p);
  }
  async moveBlock(p: { doc: string; block: string; after: string | null }): Promise<void> {
    await this.call('moveBlock', p);
  }
  async setKind(p: { doc: string; block: string; kind: string }): Promise<void> {
    await this.call('setKind', p);
  }
  async setDepth(p: { doc: string; block: string; depth: number }): Promise<void> {
    await this.call('setDepth', p);
  }
  async setAttr(p: { doc: string; block: string; key: string; value: string | null }): Promise<void> {
    await this.call('setAttr', p);
  }
  splitBlock(p: { doc: string; block: string; at: number }): Promise<string> {
    return this.call('splitBlock', p);
  }
  async mergeBlocks(p: { doc: string; first: string; second: string }): Promise<void> {
    await this.call('mergeBlocks', p);
  }

  // body text
  applyDelta(p: { doc: string; block: string; ops: Change[] }): Promise<string> {
    return this.call('applyDelta', { doc: p.doc, block: p.block, ops: opsOf(p.ops) });
  }
  async applyDeltaOn(p: {
    doc: string;
    block: string;
    base: string;
    ops: Change[];
    anchor: string | null;
  }): Promise<Applied> {
    const raw = await this.call<Applied & { anchorPos?: number | null }>('applyDeltaOn', {
      doc: p.doc,
      block: p.block,
      base: p.base,
      ops: opsOf(p.ops),
      anchor: p.anchor,
    });
    return appliedOf(raw) as Applied;
  }
  undo(p: { doc: string; block: string; token: string }): Promise<string> {
    return this.call('undo', p);
  }
  mark(p: {
    doc: string;
    block: string;
    start: number;
    end: number;
    key: string;
    value: string | null;
  }): Promise<string | null> {
    return this.call('mark', p);
  }

  // body reads
  getDocument(p: { doc: string }): Promise<Block[]> {
    return this.all('getDocument', p, MAX_BLOCK_PAGE);
  }
  getBlock(p: { doc: string; block: string }): Promise<Block | null> {
    return this.view('getBlock', p);
  }
  getBlockDelta(p: { doc: string; block: string }): Promise<Span[]> {
    return this.view('getBlockDelta', p);
  }
  getText(p: { doc: string; block: string }): Promise<string> {
    return this.view('getText', p);
  }
  listBlocks(p: { doc: string }): Promise<string[]> {
    return this.all('listBlocks', p);
  }
  getStateDigest(p: { doc: string }): Promise<string> {
    return this.view('getStateDigest', p);
  }
  passageCount(p: { doc: string; block: string; needle: string }): Promise<number> {
    return this.view('passageCount', p);
  }
  anchorAt(p: { doc: string; block: string; position: number; before: boolean }): Promise<string> {
    return this.view('anchorAt', p);
  }
  resolveIds(p: { doc: string; block: string; anchors: string[] }): Promise<Array<number | null>> {
    return this.view('resolveIds', p);
  }

  // comments
  addComment(p: { doc_id: string; body: string }): Promise<string> {
    return this.call('addComment', { docId: p.doc_id, body: p.body });
  }
  async listComments(p: { doc_id: string }): Promise<CommentDto[]> {
    return (await this.all<unknown>('listComments', { docId: p.doc_id })).map(commentOf);
  }
  async getComment(p: { id: string }): Promise<CommentDto> {
    return commentOf(await this.view('getComment', p));
  }
  async commentCount(): Promise<number> {
    return num(await this.view('commentCount'));
  }
  commentSchemaVersion(p: { id: string }): Promise<number | null> {
    return this.view('commentSchemaVersion', p);
  }
  async editComment(p: { id: string; body: string }): Promise<void> {
    await this.call('editComment', p);
  }
  async deleteComment(p: { id: string }): Promise<void> {
    await this.call('deleteComment', p);
  }
}

// ---------------------------------------------------------------- registry

/** A workspace's registry instance: owner, managers, tags, saved views. */
export class RegistryClient extends Instance {
  getOwner(): Promise<string> {
    return this.view('getOwner');
  }
  async addManager(p: { member: string }): Promise<void> {
    await this.call('addManager', p);
  }
  async removeManager(p: { member: string }): Promise<void> {
    await this.call('removeManager', p);
  }
  listManagers(): Promise<string[]> {
    return this.all('listManagers');
  }
  async setTag(p: { key: string; name: string; color: string }): Promise<void> {
    await this.call('setTag', p);
  }
  async deleteTag(p: { key: string }): Promise<void> {
    await this.call('deleteTag', p);
  }
  async listTags(): Promise<TagDto[]> {
    return this.all<TagDto>('listTags');
  }
  async saveView(p: { id: string; name: string; query: string }): Promise<void> {
    await this.call('saveView', p);
  }
  async deleteView(p: { id: string }): Promise<void> {
    await this.call('deleteView', p);
  }
  async listViews(): Promise<ViewDto[]> {
    const rows = await this.all<Record<string, unknown>>('listViews');
    return rows.map((v) => ({
      id: String(v.id ?? ''),
      name: String(v.name ?? ''),
      query: String(v.query ?? ''),
      created_by: String(v.createdBy ?? ''),
    }));
  }
}

/** The contract method each adapter method calls (for the ABI test). */
export const DOCS_METHODS = [
  'createDoc', 'getDoc', 'listDocs', 'searchDocs', 'editDoc', 'archiveDoc', 'unarchiveDoc', 'deleteDoc',
  'addTag', 'removeTag', 'getTitle', 'getTitleState', 'titleApplyDelta', 'titleApplyDeltaOn', 'titleUndo',
  'titleAnchorAt', 'titleResolve', 'insertBlock', 'deleteBlock', 'moveBlock', 'setKind', 'setDepth',
  'setAttr', 'splitBlock', 'mergeBlocks', 'applyDelta', 'applyDeltaOn', 'undo', 'mark', 'getDocument',
  'getBlock', 'getBlockDelta', 'getText', 'listBlocks', 'getStateDigest', 'passageCount', 'anchorAt',
  'resolveIds', 'addComment', 'listComments', 'getComment', 'commentCount', 'commentSchemaVersion',
  'editComment', 'deleteComment',
] as const;

export const REGISTRY_METHODS = [
  'getOwner', 'addManager', 'removeManager', 'listManagers', 'setTag', 'deleteTag', 'listTags',
  'saveView', 'deleteView', 'listViews',
] as const;
