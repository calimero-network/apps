// The shapes the hooks and screens read, and the conversions to them.
//
// The contract is called through `MeroDocsClient` (`src/generated/client.ts`,
// which `mero-app-build codegen` writes from `logic/res/abi.json`). One
// component serves both kinds of instance, a folder's docs instance and a
// workspace's registry instance, so the same class reaches both.
//
// The hooks were written against v1's abi-codegen clients, and keep those
// shapes, and the few answers that differ from v1's pass through a `to*`
// below:
//
// - results' fields are camelCase on the wire; `DocDto`, `CommentDto`,
//   `ViewDto`, the search page and the `*On` answers keep v1's snake_case;
// - 64-bit integers arrive as decimal strings, and timestamps in milliseconds
//   where v1 used nanoseconds: `created_at` / `updated_at` are converted back;
// - change steps carry `attributes` only where one was given (`wireOps`).
//
// `client.test.ts` checks the generated class against the committed ABI.

import { MeroDocsClient, type Change as WireChange } from '@/generated/client';

export { MeroDocsClient };

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

/** Milliseconds (a decimal string) as v1's nanoseconds. */
export function msToNs(ms: unknown): number {
  const n =
    typeof ms === 'string' ? Number(ms) : typeof ms === 'number' ? ms : 0;
  return Number.isFinite(n) ? n * 1_000_000 : 0;
}

const num = (v: unknown): number =>
  typeof v === 'number' ? v : Number(v ?? 0) || 0;

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

function appliedOf<T extends { anchorPos?: number | null }>(
  raw: T,
): Omit<T, 'anchorPos'> & { anchor_pos: number | null } {
  const { anchorPos, ...rest } = raw;
  return { ...rest, anchor_pos: anchorPos ?? null };
}

// ---------------------------------------------------------------- answers

/** `getDoc`'s answer. */
export const toDoc = (raw: unknown): DocDto => docOf(raw);
/** `listDocs`'s answer. */
export const toDocs = (rows: unknown): DocDto[] =>
  ((rows as unknown[] | null) ?? []).map(docOf);
/** `getComment`'s answer. */
export const toComment = (raw: unknown): CommentDto => commentOf(raw);
/** `listComments`'s answer. */
export const toComments = (rows: unknown): CommentDto[] =>
  ((rows as unknown[] | null) ?? []).map(commentOf);
/** `commentCount`'s answer (a u64). */
export const toCount = (raw: unknown): number => num(raw);

/** `searchDocs`'s answer. */
export function toSearchPage(raw: unknown): DocSearchPage {
  const page = raw as {
    hits?: DocSearchHit[];
    total?: unknown;
    nextCursor?: number | null;
  } | null;
  return {
    hits: page?.hits ?? [],
    total: num(page?.total),
    next_cursor: page?.nextCursor ?? null,
  };
}

/** `applyDeltaOn`'s answer. */
export const toApplied = (raw: unknown): Applied =>
  appliedOf(raw as Applied & { anchorPos?: number | null }) as Applied;
/** `titleApplyDeltaOn`'s answer. */
export const toTitleApplied = (raw: unknown): TitleApplied =>
  appliedOf(
    raw as TitleApplied & { anchorPos?: number | null },
  ) as TitleApplied;

/** `listTags`'s answer. */
export const toTags = (rows: unknown): TagDto[] =>
  (rows as TagDto[] | null) ?? [];

/** `listViews`'s answer. */
export function toViews(rows: unknown): ViewDto[] {
  return ((rows as Array<Record<string, unknown>> | null) ?? []).map((v) => ({
    id: String(v.id ?? ''),
    name: String(v.name ?? ''),
    query: String(v.query ?? ''),
    created_by: String(v.createdBy ?? ''),
  }));
}

/** `getDocument`'s answer. */
export const toBlocks = (raw: unknown): Block[] => raw as Block[];
/** `getBlock`'s answer. */
export const toBlock = (raw: unknown): Block | null => raw as Block | null;
/** `getBlockDelta`'s answer. */
export const toSpans = (raw: unknown): Span[] => raw as Span[];
/** `getTitleState`'s answer. */
export const toTitleState = (raw: unknown): TitleState => raw as TitleState;

/**
 * Change steps as the contract takes them (`applyDelta*`, `titleApplyDelta*`):
 * `attributes` only where one was given (`#[serde(default)]`, so the ABI has
 * it optional).
 */
export const wireOps = (ops: Change[]): WireChange[] =>
  ops.map((op) => {
    if ('delete' in op) return { delete: op.delete };
    const { attributes, ...rest } = op;
    return attributes == null ? rest : { ...rest, attributes };
  });
