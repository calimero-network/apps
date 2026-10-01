import type { ActiveChat } from "../types/Common";

export type AppEntryState =
  | "login"
  | "browse-channels"
  | "chat";

export function getAppEntryState(params: {
  isAuthenticated: boolean;
  isConfigSet: boolean;
  groupId: string;
  messengerName: string;
  activeChat: ActiveChat | null;
}): AppEntryState {
  const { isAuthenticated, isConfigSet, groupId, messengerName, activeChat } =
    params;

  if (!isAuthenticated || !isConfigSet || !groupId || !messengerName.trim()) {
    return "login";
  }

  if (!activeChat) {
    return "browse-channels";
  }

  return "chat";
}
