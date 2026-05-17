const getUrlParam = (name: string): string => {
  if (typeof window === "undefined") return "";
  const searchParams = new URLSearchParams(window.location.search);
  const fromSearch = searchParams.get(name)?.trim() || "";
  if (fromSearch) return fromSearch;
  // Also check hash params (used by Tauri desktop integration)
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  return hashParams.get(name)?.trim() || "";
};

/** Application ID: URL param `app-id` > env VITE_APPLICATION_ID > fallback */
export function getApplicationId(): string {
  return (
    getUrlParam("app-id") ||
    import.meta.env.VITE_APPLICATION_ID ||
    "37poFMF4VaNgfyeaKdGbiacWsCjySJxrtgakT8EFyVL1"
  );
}

/** Application path (WASM URL): URL param `app-path` > env VITE_APPLICATION_PATH > fallback */
export function getApplicationPath(): string {
  return (
    getUrlParam("app-path") ||
    import.meta.env.VITE_APPLICATION_PATH ||
    "https://calimero-only-peers-dev.s3.amazonaws.com/uploads/03ab62aa4676a3ecd8ca3f9da23e8923.wasm"
  );
}

/** Context ID: URL param `context-id` > env VITE_CONTEXT_ID > empty (user selects on node) */
export function getContextIdFromUrl(): string {
  return getUrlParam("context-id") || import.meta.env.VITE_CONTEXT_ID || "";
}

/** Node URL: URL param `node_url` or `node-url` for connect flow (empty if not set) */
export function getNodeUrlFromUrl(): string {
  return getUrlParam("node_url") || getUrlParam("node-url") || "";
}

const GROUP_ID_SESSION_KEY = "calimero_group_id";
const GROUP_MEMBER_IDENTITIES_SESSION_KEY = "calimero_group_member_identities";
const GROUP_ALIASES_STORAGE_KEY = "calimero_group_aliases";
const CONTEXT_OWNER_SESSION_KEY = "curb_is_context_owner";

/** Group ID: URL param `group-id` > sessionStorage > localStorage > env VITE_GROUP_ID > empty */
export function getGroupId(): string {
  const fromUrl = getUrlParam("group-id");
  if (fromUrl) {
    sessionStorage.setItem(GROUP_ID_SESSION_KEY, fromUrl);
    localStorage.setItem(GROUP_ID_SESSION_KEY, fromUrl);
    return fromUrl;
  }
  return (
    sessionStorage.getItem(GROUP_ID_SESSION_KEY) ||
    localStorage.getItem(GROUP_ID_SESSION_KEY) ||
    import.meta.env.VITE_GROUP_ID ||
    ""
  );
}

export function setGroupId(groupId: string): void {
  sessionStorage.setItem(GROUP_ID_SESSION_KEY, groupId);
  localStorage.setItem(GROUP_ID_SESSION_KEY, groupId);
}

export function clearGroupId(): void {
  sessionStorage.removeItem(GROUP_ID_SESSION_KEY);
  localStorage.removeItem(GROUP_ID_SESSION_KEY);
}

export function clearWorkspaceSelection(): void {
  clearGroupId();
  sessionStorage.removeItem(CONTEXT_OWNER_SESSION_KEY);
}

function readStoredGroupMemberIdentities(): Record<string, string> {
  try {
    const raw =
      localStorage.getItem(GROUP_MEMBER_IDENTITIES_SESSION_KEY) ||
      sessionStorage.getItem(GROUP_MEMBER_IDENTITIES_SESSION_KEY);
    if (!raw) {
      return {};
    }

    localStorage.setItem(GROUP_MEMBER_IDENTITIES_SESSION_KEY, raw);

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredGroupMemberIdentities(
  identities: Record<string, string>,
): void {
  const serialized = JSON.stringify(identities);
  localStorage.setItem(GROUP_MEMBER_IDENTITIES_SESSION_KEY, serialized);
  sessionStorage.setItem(GROUP_MEMBER_IDENTITIES_SESSION_KEY, serialized);
}

function readStoredGroupAliases(): Record<string, string> {
  try {
    const raw =
      localStorage.getItem(GROUP_ALIASES_STORAGE_KEY) ||
      sessionStorage.getItem(GROUP_ALIASES_STORAGE_KEY);
    if (!raw) {
      return {};
    }

    localStorage.setItem(GROUP_ALIASES_STORAGE_KEY, raw);
    sessionStorage.setItem(GROUP_ALIASES_STORAGE_KEY, raw);

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredGroupAliases(aliases: Record<string, string>): void {
  try {
    const serialized = JSON.stringify(aliases);
    localStorage.setItem(GROUP_ALIASES_STORAGE_KEY, serialized);
    sessionStorage.setItem(GROUP_ALIASES_STORAGE_KEY, serialized);
  } catch {
    // Alias caching is best-effort and should never block workspace join flows.
  }
}

export function getGroupMemberIdentity(groupId: string): string {
  return readStoredGroupMemberIdentities()[groupId] || "";
}

export function setGroupMemberIdentity(
  groupId: string,
  memberIdentity: string,
): void {
  if (!groupId || !memberIdentity) {
    return;
  }

  const identities = readStoredGroupMemberIdentities();
  identities[groupId] = memberIdentity;
  writeStoredGroupMemberIdentities(identities);
}

export function getStoredGroupAlias(groupId: string): string {
  return readStoredGroupAliases()[groupId] || "";
}

export function setStoredGroupAlias(groupId: string, alias: string): void {
  const trimmedAlias = alias.trim();
  if (!groupId || !trimmedAlias) {
    return;
  }

  const aliases = readStoredGroupAliases();
  aliases[groupId] = trimmedAlias;
  writeStoredGroupAliases(aliases);
}

export function clearStoredGroupAlias(groupId: string): void {
  if (!groupId) {
    return;
  }

  const aliases = readStoredGroupAliases();
  delete aliases[groupId];
  writeStoredGroupAliases(aliases);
}

export function clearGroupMemberIdentity(groupId: string): void {
  if (!groupId) {
    return;
  }

  const identities = readStoredGroupMemberIdentities();
  delete identities[groupId];
  writeStoredGroupMemberIdentities(identities);
}

const CONTEXT_MEMBER_IDENTITIES_KEY = "calimero_context_member_identities";

export function getContextMemberIdentity(contextId: string): string {
  try {
    const raw = localStorage.getItem(CONTEXT_MEMBER_IDENTITIES_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return typeof parsed[contextId] === "string" ? parsed[contextId] : "";
  } catch {
    return "";
  }
}

export function setContextMemberIdentity(contextId: string, identity: string): void {
  if (!contextId || !identity) return;
  try {
    const raw = localStorage.getItem(CONTEXT_MEMBER_IDENTITIES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[contextId] = identity;
    localStorage.setItem(CONTEXT_MEMBER_IDENTITIES_KEY, JSON.stringify(parsed));
  } catch {
    // Best-effort storage
  }
}

/** @deprecated Use getApplicationId() for dynamic app-id (URL/env). */
export const APPLICATION_ID =
  import.meta.env.VITE_APPLICATION_ID ||
  "37poFMF4VaNgfyeaKdGbiacWsCjySJxrtgakT8EFyVL1";
/** @deprecated Use getApplicationPath() for dynamic app-path (URL/env). */
export const APPLICATION_PATH =
  import.meta.env.VITE_APPLICATION_PATH ||
  "https://calimero-only-peers-dev.s3.amazonaws.com/uploads/03ab62aa4676a3ecd8ca3f9da23e8923.wasm";
/** @deprecated Use getContextIdFromUrl() for dynamic context-id (URL/env). */
export const CONTEXT_ID = import.meta.env.VITE_CONTEXT_ID || "";
