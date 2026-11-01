import { APP_NAME } from "./config";

/**
 * The audience this browser has open: an app instance (v1: a context) in a
 * company's organization (v1: a namespace). An explicit choice made on the
 * companies and audiences pages, remembered across reloads, and checked
 * against the account's instances before it is trusted (`useStoredAudience`).
 */

const KEY = `${APP_NAME}:active`;
const NAMES = `${APP_NAME}:audience-names`;
const USERNAME = `${APP_NAME}:username`;

interface Active {
  appId: string;
  orgId: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the choice lasts this page only */
  }
}

/** The open audience's app instance id. */
export function getContextId(): string | null {
  return read<Active>(KEY)?.appId ?? null;
}

/** The open audience's organization (company). */
export function getActiveNamespaceId(): string | null {
  return read<Active>(KEY)?.orgId ?? null;
}

export function setActiveAudience(appId: string, orgId: string): void {
  write(KEY, { appId, orgId });
}

export function clearActiveAudience(): void {
  write(KEY, null);
}

/** Instance names, so the shell can title the audience without a request. */
export function setAudienceName(appId: string, name: string): void {
  const names = read<Record<string, string>>(NAMES) ?? {};
  names[appId] = name;
  write(NAMES, names);
}

export function getAudienceName(appId: string): string {
  return read<Record<string, string>>(NAMES)?.[appId] ?? "";
}

export function getUsername(): string {
  return read<string>(USERNAME) ?? "";
}

export function setUsername(name: string): void {
  write(USERNAME, name);
}
