import type { ActiveChat } from "../types/Common";
import { StorageHelper } from "./storage";
import { log } from "./logger";

// Session timeout tracking
const SESSION_TIMEOUT_KEY = "sessionLastActivity";
const SESSION_TIMEOUT_MS = 3600000; // 1 hour

/**
 * Validator for ActiveChat to ensure it has required properties
 */
const isValidActiveChat = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const chat = data as Record<string, unknown>;
  return !!(chat.type && chat.id && chat.name);
};

export const updateSessionChat = (session: ActiveChat): void => {
  StorageHelper.setJSON("lastSession", session);
};

export const getStoredSession = (): ActiveChat | null => {
  const session = StorageHelper.getJSON<ActiveChat>("lastSession", isValidActiveChat);
  if (!session) {
    log.debug("Session", "No valid session found in storage");
  }
  return session;
};

export const clearStoredSession = (): void => {
  StorageHelper.removeItem("lastSession");
  log.debug("Session", "Session cleared from storage");
};

export const setDmContextId = (contextId: string): void => {
  StorageHelper.setItem("dmContextId", contextId);
};

export const getDmContextId = (): string | null => {
  return StorageHelper.getItem("dmContextId");
};

export const clearDmContextId = (): void => {
  StorageHelper.removeItem("dmContextId");
};

export const updateSessionActivity = (): void => {
  StorageHelper.setItem(SESSION_TIMEOUT_KEY, Date.now().toString());
};

export const getSessionLastActivity = (): number | null => {
  const stored = StorageHelper.getItem(SESSION_TIMEOUT_KEY);
  if (!stored) return null;
  
  const parsed = parseInt(stored, 10);
  return isNaN(parsed) ? null : parsed;
};

export const isSessionExpired = (): boolean => {
  const lastActivity = getSessionLastActivity();
  if (!lastActivity) return false; // No session data means not expired

  const now = Date.now();
  const timeSinceActivity = now - lastActivity;

  return timeSinceActivity >= SESSION_TIMEOUT_MS;
};

export const clearSessionActivity = (): void => {
  StorageHelper.removeItem(SESSION_TIMEOUT_KEY);
};
