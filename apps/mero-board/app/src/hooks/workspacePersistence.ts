/**
 * Namespace/repo selection persistence.
 *
 * Versioned so a prior build's silently auto-entered selection can never
 * leak back in as "the user's choice" - only writes from explicit selection
 * paths (picker/create/join, SSO-callback resolution) populate these keys.
 * The pre-versioning key is never read, only dropped on load.
 */
const LEGACY_ACTIVE_NS_KEY = 'issue-tracker:activeNs';
const ACTIVE_NS_KEY = 'issue-tracker:activeNs:v2';
const activeRepoKey = (nsId: string) => `issue-tracker:activeRepo:v2:${nsId}`;

function readLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLs(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - selection just isn't persisted */
  }
}

export function readActiveNs(): string | null {
  return readLs(ACTIVE_NS_KEY);
}
export function writeActiveNs(id: string | null): void {
  writeLs(ACTIVE_NS_KEY, id);
}
/** Best-effort cleanup; the legacy key is never consulted for a value. */
export function dropLegacyActiveNs(): void {
  writeLs(LEGACY_ACTIVE_NS_KEY, null);
}

export function readActiveRepo(nsId: string): string | null {
  return readLs(activeRepoKey(nsId));
}
export function writeActiveRepo(nsId: string, id: string | null): void {
  writeLs(activeRepoKey(nsId), id);
}

export function clearPersistedWorkspace(): void {
  writeLs(ACTIVE_NS_KEY, null);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('issue-tracker:activeRepo:') || k.startsWith('issue-tracker:alias-set:'))) {
        localStorage.removeItem(k);
      }
    }
  } catch { /* storage unavailable */ }
}
