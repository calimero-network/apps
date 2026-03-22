import { normalizeContextIdForJoin } from '@/api/contextIdJoin';

const STORAGE_KEY = 'mero-drive-joined-contexts';

function canonicalKey(groupId: string, contextId: string): string {
  return `${groupId}:${normalizeContextIdForJoin(contextId)}`;
}

/**
 * Remembers that this browser already completed join-context for this group/context on this node.
 * Survives navigation; cleared on logout via localStorage.clear().
 */
export function markJoinedContextOnNode(groupId: string, contextId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const k = canonicalKey(groupId, contextId);
    if (!list.includes(k)) {
      list.push(k);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // best-effort
  }
}

export function hasJoinedContextOnNode(groupId: string, contextId: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    return list.includes(canonicalKey(groupId, contextId));
  } catch {
    return false;
  }
}
