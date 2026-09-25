/**
 * Where a trustee's secret lives: this browser, and nowhere else.
 *
 * The secret `x` behind a trustee's published share is the one value in the
 * whole protocol that can decrypt anything, so it never touches the node —
 * not even the node's private storage, because a hosted node is somebody
 * else's machine. The cost is that it is only as durable as this browser's
 * storage, which is why the UI pushes a backup file before anything else.
 *
 * Losing it before the tally blocks the tally: decryption is n-of-n.
 */

export interface TrusteeKey {
  v: 1;
  contextId: string;
  pollId: string;
  account: string;
  /** 64-hex canonical scalar. */
  secret: string;
}

const PREFIX = "mero-vote:trustee:";

export const keyName = (contextId: string, pollId: string, account: string) =>
  `${PREFIX}${contextId}:${pollId}:${account}`;

export function loadTrusteeKey(
  contextId: string,
  pollId: string,
  account: string,
  storage: Storage | null = safeStorage(),
): TrusteeKey | null {
  try {
    const raw = storage?.getItem(keyName(contextId, pollId, account));
    return raw ? parseTrusteeKey(raw, { contextId, pollId, account }) : null;
  } catch {
    return null;
  }
}

export function saveTrusteeKey(key: TrusteeKey, storage: Storage | null = safeStorage()): boolean {
  try {
    storage?.setItem(keyName(key.contextId, key.pollId, key.account), JSON.stringify(key));
    return !!storage;
  } catch {
    return false;
  }
}

/** Parse a backup, refusing one made for a different poll or account. */
export function parseTrusteeKey(
  raw: string,
  expect: { contextId: string; pollId: string; account: string },
): TrusteeKey {
  const k = JSON.parse(raw) as Partial<TrusteeKey>;
  if (k.v !== 1 || typeof k.secret !== "string" || !/^[0-9a-f]{64}$/.test(k.secret)) {
    throw new Error("not a mero-vote trustee key");
  }
  if (k.pollId !== expect.pollId) throw new Error("this key is for a different poll");
  if (k.account !== expect.account) throw new Error("this key belongs to a different account");
  if (k.contextId !== expect.contextId) throw new Error("this key is for a different context");
  return k as TrusteeKey;
}

export function backupFileName(k: TrusteeKey): string {
  return `mero-vote-trustee-${k.pollId.slice(0, 12)}.json`;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
