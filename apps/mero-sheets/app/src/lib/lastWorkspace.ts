// The spreadsheet you had open last, so a reload reopens it.
//
// Reloading used to land on the picker every time: the open spreadsheet lived
// only in React state, so you picked the same one again after every refresh.
//
// What is remembered is scoped to the NODE: one browser can sign in to several
// nodes, and a context id from one means nothing on another. It is only a
// hint: it is checked against what this node lists right now before anything
// opens, so a spreadsheet that was deleted, or a workspace you have since left,
// falls back to the picker (and is forgotten) instead of opening a screen that
// can only fail. Same rule as mero-design's `lastVisit`.
//
// Every access is wrapped: `localStorage` throws outright in Safari private
// mode and when site data is blocked, and forgetting is always acceptable.

export interface LastWorkspace {
  /** The namespace (workspace) the spreadsheet was opened in. */
  namespaceId?: string;
  /** The spreadsheet's context id. Absent after "Back to spreadsheets". */
  contextId?: string;
}

const PREFIX = 'mero-sheets:last-workspace:';

/** The storage key for one node. Exported for tests. */
export function lastWorkspaceKey(nodeUrl: string | null | undefined): string {
  return `${PREFIX}${(nodeUrl ?? '').replace(/\/+$/, '') || 'local'}`;
}

export function readLastWorkspace(nodeUrl: string | null | undefined): LastWorkspace {
  try {
    const raw = window.localStorage.getItem(lastWorkspaceKey(nodeUrl));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const { namespaceId, contextId } = parsed as Record<string, unknown>;
    const out: LastWorkspace = {};
    if (typeof namespaceId === 'string' && namespaceId) out.namespaceId = namespaceId;
    if (typeof contextId === 'string' && contextId) out.contextId = contextId;
    return out;
  } catch {
    // Blocked storage or a corrupt entry is a cold start, not a failure.
    return {};
  }
}

function write(nodeUrl: string | null | undefined, next: LastWorkspace): void {
  try {
    window.localStorage.setItem(lastWorkspaceKey(nodeUrl), JSON.stringify(next));
  } catch {
    /* quota / private mode: forgetting is fine */
  }
}

/** Remember the spreadsheet just opened, and the workspace it is in. */
export function rememberWorkspace(
  nodeUrl: string | null | undefined,
  namespaceId: string,
  contextId: string,
): void {
  if (!namespaceId || !contextId) return;
  const cur = readLastWorkspace(nodeUrl);
  if (cur.namespaceId === namespaceId && cur.contextId === contextId) return;
  write(nodeUrl, { namespaceId, contextId });
}

/**
 * Forget the spreadsheet but keep the workspace: "Back to spreadsheets" means
 * the picker is where you want to be, reload or not.
 */
export function forgetLastSpreadsheet(nodeUrl: string | null | undefined): void {
  const cur = readLastWorkspace(nodeUrl);
  if (!cur.contextId) return;
  write(nodeUrl, cur.namespaceId ? { namespaceId: cur.namespaceId } : {});
}

/** Forget everything for this node (log out, or the workspace is gone). */
export function forgetLastWorkspace(nodeUrl: string | null | undefined): void {
  try {
    window.localStorage.removeItem(lastWorkspaceKey(nodeUrl));
  } catch {
    /* nothing to forget */
  }
}

/**
 * The namespace to show: the one just joined by invitation, else the
 * remembered one while the node still lists it, else the first listed.
 */
export function pickNamespace(
  listed: readonly string[],
  joined: string | null,
  remembered: string | undefined,
): string | null {
  if (joined && listed.includes(joined)) return joined;
  if (remembered && listed.includes(remembered)) return remembered;
  return listed[0] ?? null;
}

/**
 * The spreadsheet to reopen on startup: the remembered one, if it was opened in
 * the namespace now shown and that namespace still lists it. Never a guess —
 * with nothing (valid) remembered the picker shows every spreadsheet.
 */
export function pickResume(
  namespaceId: string | null,
  listedContexts: readonly string[],
  remembered: LastWorkspace,
): string | null {
  if (!namespaceId || !remembered.contextId) return null;
  if (remembered.namespaceId !== namespaceId) return null;
  return listedContexts.includes(remembered.contextId) ? remembered.contextId : null;
}
