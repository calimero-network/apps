// Doc texts already read this session, keyed by docs context and doc, with
// the list version each was read at. The text index is remounted per
// workspace, and without this every switch back re-read every document.
//
// Memory only, on purpose: document text is plaintext, and nothing here may
// reach localStorage or IndexedDB. A reload, or a new sign-in (a new mero
// client), starts empty.

import type { DocText } from '../workspaceIndex/types';

export type CachedText = { version: number; text: DocText };

const bySession = new WeakMap<object, Map<string, CachedText>>();

/** The cache of the session `owner` (the signed-in mero client) reads for. */
export function textCache(owner: object): Map<string, CachedText> {
  let cache = bySession.get(owner);
  if (!cache) {
    cache = new Map();
    bySession.set(owner, cache);
  }
  return cache;
}

/** A doc's slot: the context is part of it, so a moved folder is not confused. */
export function textCacheKey(contextId: string, rowKey: string): string {
  return `${contextId}\n${rowKey}`;
}
