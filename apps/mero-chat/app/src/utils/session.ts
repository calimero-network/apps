import type { ActiveChat } from "../types/Common";
import { getGroupId } from "../constants/config";
import { StorageHelper } from "./storage";

/**
 * The conversation open last in each workspace, so a reload reopens it. Keyed
 * by workspace: a conversation of one org means nothing in another.
 */
const key = () => `lastSession:${getGroupId()}`;

const isValidActiveChat = (data: unknown): boolean => {
  if (!data || typeof data !== "object") return false;
  const chat = data as Record<string, unknown>;
  return !!(chat.type && chat.id && chat.name);
};

export const updateSessionChat = (session: ActiveChat): void => {
  StorageHelper.setJSON(key(), session);
};

export const getStoredSession = (): ActiveChat | null => StorageHelper.getJSON<ActiveChat>(key(), isValidActiveChat);

export const clearStoredSession = (): void => {
  StorageHelper.removeItem(key());
};
