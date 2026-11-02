import type { CalimeroClient } from "@calimero-network/mero-js";

import type {
  AttachmentRequest,
  AttachmentResponse,
  FullMessageResponse,
  MessageWithReactions,
  SearchHit,
  SearchPage,
} from "../api/clientApi";

/** The package a production instance is created from (`[package.metadata.calimero]`). */
export const PACKAGE = "com.calimero.chat";

/**
 * The contract's methods by their ABI names (camelCase), split the way the node
 * runs them: a call goes through the app's log, a view is answered by a node
 * without writing. `chat.test.ts` asserts these lists, and the parameter names
 * each wrapper sends, are exactly the committed `logic/res/abi.json`'s.
 */
export const CALLS = [
  "updateInfo",
  "markAsRead",
  "setProfile",
  "saveDraft",
  "deleteDraft",
  "setMemberRole",
  "sendMessage",
  "updateReaction",
  "editMessage",
  "deleteMessage",
] as const;
export const VIEWS = [
  "getInfo",
  "getChannelInfo",
  "markMessagesAsRead",
  "getUnreadCount",
  "getUnreadMentions",
  "getProfiles",
  "getDraft",
  "getMemberRole",
  "listRoles",
  "getMessages",
  "getMessagesFrom",
  "getMessageCount",
  "searchMessages",
  "messagePosition",
  "messageIdAt",
  "searchMessagesScan",
] as const;

export type Role = "User" | "Mod" | "Admin" | "Banned";
export type ContextType = "Channel" | "Dm";

// ── the contract's answers, as the wire carries them (u64 as decimal strings) ──

export interface WireAttachment {
  name: string;
  mimeType: string;
  size: string;
  blobId: string;
  uploadedAt: string;
}

export interface WireMessage {
  index: string;
  timestamp: string;
  sender: string;
  mentions: string[];
  mentionsUsernames: string[];
  files: WireAttachment[];
  images: WireAttachment[];
  id: string;
  text: string;
  editedOn: string | null;
  reactions: Record<string, string[]> | null;
  deleted: boolean | null;
  threadCount: number;
  threadLastTimestamp: string;
  parentMessageId: string | null;
}

export interface WireWindow {
  totalCount: number;
  messages: WireMessage[];
  startPosition: number;
}

export interface WireHit {
  id: string;
  parentMessageId: string | null;
  index: string | null;
  timestamp: string;
  anchorTimestamp: string;
  sender: string;
  snippet: string;
  matchStart: number;
  matchEnd: number;
}

export interface WireSearchPage {
  hits: WireHit[];
  nextCursor: string | null;
  frontierTimestamp: string | null;
}

export interface Info {
  name: string;
  contextType: ContextType;
  description: string;
  createdAt: string;
  creator: string;
}

export interface Profile {
  identity: string;
  username: string;
  avatar: string | null;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface InitArgs {
  name?: string;
  contextType?: ContextType;
  description?: string;
  createdAt?: string;
  creatorUsername?: string;
}

// ── the adapter: answers back to the shapes the screens were written for ──────

const num = (s: string | null | undefined): number => (s == null ? 0 : Number(s));

export function toAttachment(a: WireAttachment): AttachmentResponse {
  return {
    name: a.name,
    blob_id: a.blobId,
    mime_type: a.mimeType,
    size: num(a.size),
    uploaded_at: num(a.uploadedAt),
  };
}

export function toMessage(m: WireMessage): MessageWithReactions {
  return {
    index: num(m.index),
    id: m.id,
    sender: m.sender,
    text: m.text,
    timestamp: num(m.timestamp),
    deleted: m.deleted ?? undefined,
    edited_on: m.editedOn == null ? undefined : num(m.editedOn),
    reactions: m.reactions ?? {},
    thread_count: m.threadCount,
    thread_last_timestamp: num(m.threadLastTimestamp),
    files: m.files.map(toAttachment),
    images: m.images.map(toAttachment),
    parent_message_id: m.parentMessageId ?? undefined,
    mentions: m.mentions,
    mentions_usernames: m.mentionsUsernames,
  };
}

export function toWindow(w: WireWindow): FullMessageResponse {
  return {
    total_count: w.totalCount,
    start_position: w.startPosition,
    messages: w.messages.map(toMessage),
  };
}

export function toHit(h: WireHit): SearchHit {
  return {
    id: h.id,
    parent_message_id: h.parentMessageId,
    index: h.index == null ? null : num(h.index),
    timestamp: num(h.timestamp),
    anchor_timestamp: num(h.anchorTimestamp),
    sender: h.sender,
    snippet: h.snippet,
    match_start: h.matchStart,
    match_end: h.matchEnd,
  };
}

export function toSearchPage(p: WireSearchPage): SearchPage {
  return {
    hits: p.hits.map(toHit),
    next_cursor: p.nextCursor,
    frontier_timestamp: p.frontierTimestamp == null ? null : num(p.frontierTimestamp),
  };
}

const wireAttachment = (a: AttachmentRequest) => ({
  name: a.name,
  mimeType: a.mime_type,
  size: String(a.size),
  blobIdStr: a.blob_id_str,
});

// ── the typed client ──────────────────────────────────────────────────────────

export interface SendArgs {
  message: string;
  mentions: string[];
  mentionsUsernames: string[];
  parentMessage?: string | null;
  /** Seconds since the epoch. */
  timestamp: number;
  files?: AttachmentRequest[];
  images?: AttachmentRequest[];
}

export interface Chat {
  getInfo(): Promise<Info>;
  getChannelInfo(channel?: string): Promise<Info>;
  updateInfo(name: string | null, description: string | null): Promise<string>;
  /** The no-op kept from v1 (records nothing). */
  markMessagesAsRead(channel?: string, timestamp?: number): Promise<string>;
  markAsRead(timestamp: number): Promise<string>;
  getUnreadCount(): Promise<number>;
  getUnreadMentions(): Promise<number>;
  setProfile(username: string, avatar: string | null): Promise<string>;
  getProfiles(cursor?: string | null, limit?: number): Promise<Page<Profile>>;
  saveDraft(channel: string, text: string): Promise<null>;
  getDraft(channel: string): Promise<string>;
  deleteDraft(channel: string): Promise<null>;
  getMemberRole(identity: string): Promise<Role>;
  listRoles(cursor?: string | null, limit?: number): Promise<Page<{ identity: string; role: Role }>>;
  setMemberRole(target: string, role: Role): Promise<string>;
  sendMessage(args: SendArgs): Promise<MessageWithReactions>;
  getMessages(args: {
    parentMessage?: string | null;
    limit?: number;
    offset?: number;
    searchTerm?: string | null;
  }): Promise<FullMessageResponse>;
  getMessagesFrom(start: number, limit?: number): Promise<FullMessageResponse>;
  getMessageCount(): Promise<number>;
  searchMessages(query: string, cursor?: string | null, limit?: number): Promise<SearchPage>;
  searchMessagesScan(query: string, cursor?: string | null, limit?: number): Promise<SearchPage>;
  messagePosition(messageId: string): Promise<number | null>;
  messageIdAt(index: number, parentMessage?: string | null): Promise<string | null>;
  updateReaction(messageId: string, emoji: string, add: boolean): Promise<string>;
  editMessage(messageId: string, newMessage: string, timestamp: number, parentId?: string | null): Promise<MessageWithReactions>;
  deleteMessage(messageId: string, parentId?: string | null): Promise<string>;
}

type Transport = Pick<CalimeroClient, "call" | "view">;

/** Drops `undefined` keys: the contract refuses unknown keys, not absent ones. */
function args(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

/** The conversation at instance `app` through `client`; `after` runs after every request. */
export function chat(client: Transport, app: string, after: () => void = () => {}): Chat {
  const call = async <T>(method: (typeof CALLS)[number], a: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.call(app, method, args(a))).result as T;
    } finally {
      after();
    }
  };
  const view = async <T>(method: (typeof VIEWS)[number], a: Record<string, unknown> = {}): Promise<T> => {
    try {
      return (await client.view(app, method, args(a))).result as T;
    } finally {
      after();
    }
  };
  return {
    getInfo: () => view("getInfo"),
    getChannelInfo: (channel) => view("getChannelInfo", { channel }),
    updateInfo: (name, description) => call("updateInfo", { name, description }),
    markMessagesAsRead: (channel, timestamp) =>
      view("markMessagesAsRead", {
        channel,
        timestamp: timestamp === undefined ? undefined : String(Math.floor(timestamp)),
      }),
    markAsRead: (timestamp) => call("markAsRead", { timestamp: String(Math.floor(timestamp)) }),
    getUnreadCount: () => view("getUnreadCount"),
    getUnreadMentions: () => view("getUnreadMentions"),
    setProfile: (username, avatar) => call("setProfile", { username, avatar }),
    getProfiles: (cursor, limit) => view("getProfiles", { cursor: cursor ?? undefined, limit }),
    saveDraft: (channel, text) => call("saveDraft", { channel, text }),
    getDraft: (channel) => view("getDraft", { channel }),
    deleteDraft: (channel) => call("deleteDraft", { channel }),
    getMemberRole: (identity) => view("getMemberRole", { identity }),
    listRoles: (cursor, limit) => view("listRoles", { cursor: cursor ?? undefined, limit }),
    setMemberRole: (target, role) => call("setMemberRole", { target, role }),
    sendMessage: async (a) =>
      toMessage(
        await call<WireMessage>("sendMessage", {
          message: a.message,
          mentions: a.mentions,
          mentionsUsernames: a.mentionsUsernames,
          parentMessage: a.parentMessage ?? undefined,
          timestamp: String(Math.floor(a.timestamp)),
          files: a.files?.length ? a.files.map(wireAttachment) : undefined,
          images: a.images?.length ? a.images.map(wireAttachment) : undefined,
        }),
      ),
    getMessages: async (a) =>
      toWindow(
        await view<WireWindow>("getMessages", {
          parentMessage: a.parentMessage ?? undefined,
          limit: a.limit,
          offset: a.offset,
          searchTerm: a.searchTerm ?? undefined,
        }),
      ),
    getMessagesFrom: async (start, limit) =>
      toWindow(await view<WireWindow>("getMessagesFrom", { start: String(start), limit })),
    getMessageCount: async () => num(await view<string>("getMessageCount")),
    searchMessages: async (query, cursor, limit) =>
      toSearchPage(await view<WireSearchPage>("searchMessages", { query, cursor: cursor ?? undefined, limit })),
    searchMessagesScan: async (query, cursor, limit) =>
      toSearchPage(await view<WireSearchPage>("searchMessagesScan", { query, cursor: cursor ?? undefined, limit })),
    messagePosition: async (messageId) => {
      const at = await view<string | null>("messagePosition", { messageId });
      return at == null ? null : num(at);
    },
    messageIdAt: (index, parentMessage) =>
      view("messageIdAt", { index: String(index), parentMessage: parentMessage ?? undefined }),
    updateReaction: (messageId, emoji, add) => call("updateReaction", { messageId, emoji, add }),
    editMessage: async (messageId, newMessage, timestamp, parentId) =>
      toMessage(
        await call<WireMessage>("editMessage", {
          messageId,
          newMessage,
          timestamp: String(Math.floor(timestamp)),
          parentId: parentId ?? undefined,
        }),
      ),
    deleteMessage: (messageId, parentId) => call("deleteMessage", { messageId, parentId: parentId ?? undefined }),
  };
}
