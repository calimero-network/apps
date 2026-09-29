/**
 * Searching every channel and DM at once, a page at a time.
 *
 * Each context answers `search_messages` newest first with an opaque cursor,
 * so the merge is a k-way merge over streams that arrive in pages. The one
 * subtlety is when a hit may be SHOWN: a context that has more pages can
 * still produce a hit newer than one already fetched from another context.
 * Every page reports a frontier (the oldest timestamp it read), and nothing
 * a context has not returned yet ranks above its frontier. So a hit is safe
 * to show once it ranks at or above the highest frontier among the contexts
 * that are not finished; everything below waits for "load more", which reads
 * the next page from exactly the contexts holding that frontier up.
 *
 * Frontiers are sender clocks, so this is newest-first up to clock skew,
 * which is also what the contract promises within one channel.
 */

import type {
  FullMessageResponse,
  SearchHit,
  SearchPage,
} from "../api/clientApi";
import type { ResponseData } from "../api/types";
import { toPlainText } from "../utils/plainText";

/** Hits asked of each context per page. */
export const SEARCH_PAGE_SIZE = 20;
/** Contexts searched at once. */
export const SEARCH_CONCURRENCY = 4;
/** One context's page, at most; a slow node must not hold up the others. */
export const SEARCH_TIMEOUT_MS = 10_000;
/**
 * Most pages one search or "load more" reads before it shows what it has.
 * A rare term in a long channel returns empty pages (each call's work is
 * capped); this keeps one click from walking the whole history.
 */
export const SEARCH_MAX_ROUNDS = 6;

export interface SearchContext {
  contextId: string;
  executorPublicKey: string;
  label: string;
}

/** A hit as the results list shows it. Timestamps are milliseconds. */
export interface SearchResult {
  key: string;
  id: string;
  contextId: string;
  contextLabel: string;
  parentMessageId?: string;
  /** Position of the top-level message: what a permalink needs; -1 if unknown. */
  index: number;
  /** The id of the message at `index`: the hit, or a reply's parent. */
  indexMessageId: string;
  timestamp: number;
  anchorTimestamp: number;
  sender: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface ContextSearch {
  context: SearchContext;
  hits: SearchResult[];
  /** The next page's cursor; `null` before the first page. */
  cursor: string | null;
  done: boolean;
  /** Milliseconds; `null` until a page read anything. */
  frontier: number | null;
  error?: string;
}

export function startSearch(contexts: SearchContext[]): ContextSearch[] {
  return contexts.map((context) => ({
    context,
    hits: [],
    cursor: null,
    done: false,
    frontier: null,
  }));
}

function toResult(context: SearchContext, hit: SearchHit): SearchResult {
  return {
    key: `${context.contextId}:${hit.id}`,
    id: hit.id,
    contextId: context.contextId,
    contextLabel: context.label,
    parentMessageId: hit.parent_message_id ?? undefined,
    index: hit.index,
    indexMessageId: hit.parent_message_id ?? hit.id,
    timestamp: hit.timestamp * 1000,
    anchorTimestamp: hit.anchor_timestamp * 1000,
    sender: hit.sender,
    snippet: hit.snippet,
    matchStart: hit.match_start,
    matchEnd: hit.match_end,
  };
}

/** A context's state after one more page. */
export function applyPage(state: ContextSearch, page: SearchPage): ContextSearch {
  const seen = new Set(state.hits.map((h) => h.key));
  const fresh = page.hits
    .map((hit) => toResult(state.context, hit))
    .filter((r) => !seen.has(r.key));
  const pageFrontier =
    page.frontier_timestamp == null ? null : page.frontier_timestamp * 1000;
  const frontier =
    pageFrontier === null
      ? state.frontier
      : Math.min(state.frontier ?? pageFrontier, pageFrontier);
  return {
    ...state,
    hits: [...state.hits, ...fresh],
    cursor: page.next_cursor ?? null,
    done: !page.next_cursor,
    frontier,
    error: undefined,
  };
}

export function failPage(state: ContextSearch, error: string): ContextSearch {
  return { ...state, done: true, error };
}

/**
 * The rank at or above which every hit is final: the highest frontier among
 * unfinished contexts. `-Infinity` once all are finished; `+Infinity` while
 * one has not answered at all.
 */
export function threshold(states: ContextSearch[]): number {
  let t = -Infinity;
  for (const s of states) {
    if (s.done) continue;
    t = Math.max(t, s.frontier ?? Infinity);
  }
  return t;
}

function newestFirst(a: SearchResult, b: SearchResult): number {
  return (
    b.anchorTimestamp - a.anchorTimestamp ||
    b.index - a.index ||
    // A thread's parent first, then its replies in the order they were sent.
    Number(!!a.parentMessageId) - Number(!!b.parentMessageId) ||
    a.timestamp - b.timestamp ||
    a.key.localeCompare(b.key)
  );
}

/** The hits that can be shown now, newest first. */
export function visibleResults(states: ContextSearch[]): SearchResult[] {
  const t = threshold(states);
  return states
    .flatMap((s) => s.hits)
    .filter((h) => h.anchorTimestamp >= t)
    .sort(newestFirst);
}

export function hasMore(states: ContextSearch[]): boolean {
  return states.some((s) => !s.done);
}

/**
 * The contexts the next round reads: the unfinished ones holding the
 * threshold up, highest frontier first. Reading them is what lowers it.
 */
export function nextToFetch(
  states: ContextSearch[],
  max = SEARCH_CONCURRENCY,
): number[] {
  return states
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.done)
    .sort((a, b) => (b.s.frontier ?? Infinity) - (a.s.frontier ?? Infinity))
    .slice(0, max)
    .map(({ i }) => i);
}

/** `promise`, or a rejection after `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`No answer within ${ms / 1000}s`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs `task` over `items`, at most `limit` at a time. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** Whether an error says the context's app has no `search_messages` yet. */
export function isMissingMethod(message: string | undefined): boolean {
  return !!message && /search_messages\W+not found|MethodNotFound/i.test(message);
}

/**
 * The one page an app older than `search_messages` can give: its newest
 * matches from `search_all_messages`, as hits. That call has no cursor, so
 * the context is finished after it.
 */
export function legacyPage(
  response: ResponseData<FullMessageResponse>,
  query: string,
): SearchPage {
  const needle = query.toLowerCase();
  const hits: SearchHit[] = (response.data?.messages ?? []).map((m) => {
    const snippet = toPlainText(m.text).slice(0, 160);
    const at = snippet.toLowerCase().indexOf(needle);
    return {
      id: m.id,
      parent_message_id: m.parent_message_id ?? null,
      // A legacy reply's index is its place in the thread, not a channel
      // position; -1 says there is none to link to.
      index: m.parent_message_id ? -1 : m.index,
      timestamp: m.timestamp,
      anchor_timestamp: m.timestamp,
      sender: m.sender,
      snippet,
      match_start: Math.max(at, 0),
      match_end: at < 0 ? 0 : at + needle.length,
    };
  });
  return { hits, next_cursor: null, frontier_timestamp: null };
}
