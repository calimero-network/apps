import type { Conversation, Member } from "./workspace";

/**
 * What the open workspace holds, for code outside React (the data source's
 * member lists, the name repository): its conversations and its members.
 * `Home` keeps it current; it is empty outside a workspace.
 */
let conversations = new Map<string, Conversation>();
let members: Member[] = [];
let privateRosters = new Map<string, string[]>();

export function setConversations(list: Conversation[]): void {
  conversations = new Map(list.map((c) => [c.appId, c]));
}

export function conversationOf(app: string): Conversation | undefined {
  return conversations.get(app);
}

export function setMembers(list: Member[]): void {
  members = list;
}

export function workspaceMembers(): Member[] {
  return members;
}

/** Who reaches a private channel besides its creator (from `getApp`), cached by `Home`. */
export function setPrivateRoster(app: string, accounts: string[]): void {
  privateRosters = new Map(privateRosters).set(app, accounts);
}

/** The accounts that reach `app`: every member for a channel, the two people of a DM. */
export function accountsOf(app: string): string[] {
  const c = conversations.get(app);
  if (!c || c.kind === "channel") return members.map((m) => m.account);
  if (c.kind === "dm") return [...(c.accounts ?? [])];
  return [...new Set([c.owner, ...(privateRosters.get(app) ?? [])])];
}

export function clearRegistry(): void {
  conversations = new Map();
  members = [];
  privateRosters = new Map();
}
