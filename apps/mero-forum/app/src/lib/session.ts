/**
 * The forum this browser has open, remembered across reloads, per cluster and
 * per account (`bindScope`): a dev session's forum never opens on a Cloud
 * cluster, and the next person to sign in on this browser does not boot into
 * the previous person's forum.
 *
 * v1 kept a context id, the executor key that context knew the node by, the
 * namespace and the node URL here. On Calimero 1.0 a forum is an app instance
 * and the account is the caller, so this is the instance id, its org (the
 * space) and its name.
 */

interface Active {
  appId: string;
  org: string | null;
}

let scope = "signed-out";
let active: Active | null = null;

const activeKey = () => `mero-forum:active:${scope}`;
const nameKey = (appId: string) => `mero-forum:forum-name:${scope}:${appId}`;
const usernameKey = () => `mero-forum:username:${scope}`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* remembered for this page only */
  }
}

/** Switches to the stored state of `key` (`<target>:<account>`), or of nobody. */
export function bindScope(key: string | null): void {
  scope = key ?? "signed-out";
  active = null;
  const raw = read(activeKey());
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as Partial<Active>;
    if (typeof parsed.appId === "string" && parsed.appId) {
      active = { appId: parsed.appId, org: typeof parsed.org === "string" ? parsed.org : null };
    }
  } catch {
    /* nothing usable stored */
  }
}

/** The open forum's instance id. */
export function getContextId(): string | null {
  return active?.appId ?? null;
}

/** The open forum's space (org). */
export function getActiveNamespaceId(): string | null {
  return active?.org ?? null;
}

export function setActiveForum(appId: string, org: string | null): void {
  active = { appId, org };
  write(activeKey(), JSON.stringify(active));
}

export function clearActiveForum(): void {
  active = null;
  write(activeKey(), null);
}

export function setForumName(appId: string, name: string): void {
  if (appId && name.trim()) write(nameKey(appId), name.trim());
}

export function getForumName(appId: string): string {
  return read(nameKey(appId)) ?? "";
}

/** The name typed into the nickname field, so it is there before any read returns. */
export function getUsername(): string {
  return read(usernameKey()) ?? "";
}

export function setUsername(name: string): void {
  write(usernameKey(), name.trim() || null);
}
