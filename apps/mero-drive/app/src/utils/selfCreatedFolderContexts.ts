import { normalizeContextIdForJoin } from '@/api/contextIdJoin';

const STORAGE_KEY = 'mero-drive-self-created-contexts';

function token(groupId: string, contextId: string): string {
  return `${groupId}:${normalizeContextIdForJoin(contextId)}`;
}

/** Remember that this browser created this folder context (same node session). */
export function markSelfCreatedFolderContext(groupId: string, contextId: string): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const t = token(groupId, contextId);
    if (!list.includes(t)) {
      list.push(t);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // best-effort
  }
}

export function isSelfCreatedFolderContext(groupId: string, contextId: string): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    return list.includes(token(groupId, contextId));
  } catch {
    return false;
  }
}
