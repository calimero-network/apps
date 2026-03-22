const getUrlParam = (name: string): string => {
  if (typeof window === 'undefined') return '';
  const fromSearch = new URLSearchParams(window.location.search).get(name)?.trim() || '';
  if (fromSearch) return fromSearch;
  const fromHash = new URLSearchParams(window.location.hash.slice(1)).get(name)?.trim() || '';
  return fromHash;
};

const GROUP_MEMBER_IDENTITIES_STORAGE_KEY = 'calimero_group_member_identities';

function readStoredGroupMemberIdentities(): Record<string, string> {
  try {
    const raw =
      localStorage.getItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY) ||
      sessionStorage.getItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    localStorage.setItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY, raw);
    sessionStorage.setItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY, raw);

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredGroupMemberIdentities(identities: Record<string, string>): void {
  try {
    const serialized = JSON.stringify(identities);
    localStorage.setItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY, serialized);
    sessionStorage.setItem(GROUP_MEMBER_IDENTITIES_STORAGE_KEY, serialized);
  } catch {
    // Best-effort cache only.
  }
}

export function getGroupMemberIdentity(groupId: string): string {
  return readStoredGroupMemberIdentities()[groupId] || '';
}

export function setGroupMemberIdentity(groupId: string, memberIdentity: string): void {
  if (!groupId || !memberIdentity) {
    return;
  }

  const identities = readStoredGroupMemberIdentities();
  identities[groupId] = memberIdentity;
  writeStoredGroupMemberIdentities(identities);
}

/** Node URL: URL param `node_url` or `node-url` — used for connect flow */
export function getNodeUrlFromUrl(): string {
  return getUrlParam('node_url') || getUrlParam('node-url') || '';
}

/** Application ID: URL param `app-id` > env VITE_APPLICATION_ID > fallback */
export function getApplicationId(): string {
  return (
    getUrlParam('app-id') ||
    (import.meta.env.VITE_APPLICATION_ID as string | undefined)?.trim() ||
    '3jLicRUbTH7D6WFaGW7gkjvxJ6eztPe7Dc5GXv7Dng9M'
  );
}

/** Application path: URL param `app-path` > env VITE_APPLICATION_PATH > empty */
export function getApplicationPath(): string {
  return (
    getUrlParam('app-path') ||
    (import.meta.env.VITE_APPLICATION_PATH as string | undefined)?.trim() ||
    ''
  );
}
