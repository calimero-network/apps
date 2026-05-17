import type { ActiveChat, ChatType } from "../types/Common";

export function buildChannelEntryChat(params: {
  contextId: string;
  name: string;
  contextIdentity: string;
  username?: string;
}): ActiveChat {
  const { contextId, name, contextIdentity, username = "" } = params;

  return {
    type: "channel" as ChatType,
    id: contextId,
    contextId,
    name,
    contextIdentity,
    canJoin: false,
    requiresProfileSetup: false,
    username: username || undefined,
  };
}
