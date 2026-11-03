/**
 * The chat contract, typed, over `CalimeroClient.call` / `view`.
 *
 * The screens and `ClientApiDataSource` still speak v1: snake_case method
 * names (`send_message`), snake_case arguments and answers, numbers for
 * timestamps. The component ABI (`logic/res/abi.json`) names methods and
 * fields in camelCase and sends 64-bit integers as decimal strings. This file
 * is the one place that knows both: `execute(app, "send_message", {...})`
 * answers exactly what v1 answered, so nothing above it changes.
 *
 * `meroChat.test.ts` checks every method and parameter here against the
 * committed ABI.
 */
import type { CalimeroClient } from "@calimero-network/mero-js";
import { AppError } from "@calimero-network/mero-js";

import { after, getClient } from "./calimero";

type Args = Record<string, unknown>;
type Out = unknown;

interface MethodSpec {
  /** The ABI name. */
  method: string;
  kind: "call" | "view";
  /** v1 arguments → the ABI's (camelCase, u64 as decimal strings). */
  args: (a: Args) => Args;
  /** The ABI's answer → v1's. */
  result: (r: Out) => Out;
}

// ── conversions ──────────────────────────────────────────────────────────────

/** A u64 for the wire: a canonical decimal string. */
export function u64(v: unknown): string {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return String(Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0)));
}

function optU64(v: unknown): string | null {
  return v === undefined || v === null ? null : u64(v);
}

/** A u64 (decimal string, or a number) from the wire, as v1's number. */
export function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return 0;
}

function optNum(v: unknown): number | null {
  return v === undefined || v === null ? null : num(v);
}

function optStr(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function optInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.trunc(v)) : null;
}

type Rec = Record<string, unknown>;

/** v1's `AttachmentResponse`. */
function attachmentOut(a: Rec) {
  return {
    name: String(a.name ?? ""),
    mime_type: String(a.mimeType ?? ""),
    size: num(a.size),
    blob_id: String(a.blobId ?? ""),
    uploaded_at: num(a.uploadedAt),
  };
}

/** v1's `AttachmentRequest` → the ABI's `AttachmentInput`. */
function attachmentIn(a: Rec) {
  return {
    name: String(a.name ?? ""),
    mimeType: String(a.mime_type ?? ""),
    size: Math.max(0, Math.trunc(num(a.size))),
    blobIdStr: String(a.blob_id_str ?? ""),
  };
}

function attachmentsIn(v: unknown) {
  return Array.isArray(v) ? v.map((a) => attachmentIn(a as Rec)) : null;
}

/** v1's `MessageWithReactions`. */
export function messageOut(m: Rec) {
  return {
    index: num(m.index),
    timestamp: num(m.timestamp),
    sender: String(m.sender ?? ""),
    mentions: Array.isArray(m.mentions) ? (m.mentions as string[]) : [],
    mentions_usernames: Array.isArray(m.mentionsUsernames) ? (m.mentionsUsernames as string[]) : [],
    files: Array.isArray(m.files) ? (m.files as Rec[]).map(attachmentOut) : [],
    images: Array.isArray(m.images) ? (m.images as Rec[]).map(attachmentOut) : [],
    id: String(m.id ?? ""),
    text: String(m.text ?? ""),
    edited_on: optNum(m.editedOn) ?? undefined,
    // Emoji keys are data, not field names: copied as they are.
    reactions: (m.reactions as Record<string, string[]> | null) ?? null,
    deleted: m.deleted === null || m.deleted === undefined ? undefined : Boolean(m.deleted),
    thread_count: num(m.threadCount),
    thread_last_timestamp: num(m.threadLastTimestamp),
    parent_message_id: optStr(m.parentMessageId) ?? undefined,
  };
}

function fullOut(r: Out) {
  const p = (r ?? {}) as Rec;
  return {
    total_count: num(p.totalCount),
    messages: Array.isArray(p.messages) ? (p.messages as Rec[]).map(messageOut) : [],
    start_position: num(p.startPosition),
  };
}

function searchOut(r: Out) {
  const p = (r ?? {}) as Rec;
  return {
    hits: (Array.isArray(p.hits) ? (p.hits as Rec[]) : []).map((h) => ({
      id: String(h.id ?? ""),
      parent_message_id: optStr(h.parentMessageId),
      index: optNum(h.index),
      timestamp: num(h.timestamp),
      anchor_timestamp: num(h.anchorTimestamp),
      sender: String(h.sender ?? ""),
      snippet: String(h.snippet ?? ""),
      match_start: num(h.matchStart),
      match_end: num(h.matchEnd),
    })),
    next_cursor: optStr(p.nextCursor),
    frontier_timestamp: optNum(p.frontierTimestamp),
  };
}

function infoOut(r: Out) {
  const p = (r ?? {}) as Rec;
  return {
    name: String(p.name ?? ""),
    context_type: p.contextType === "Dm" ? "Dm" : "Channel",
    description: String(p.description ?? ""),
    created_at: num(p.createdAt),
    creator: String(p.creator ?? ""),
  };
}

const same = (r: Out) => r;
const none = () => ({});

// ── the method table: v1 name → ABI ──────────────────────────────────────────

export const METHODS: Record<string, MethodSpec> = {
  get_info: { method: "getInfo", kind: "view", args: none, result: infoOut },
  get_channel_info: {
    method: "getChannelInfo",
    kind: "view",
    args: (a) => ({ channel: optStr(a.channel) }),
    result: infoOut,
  },
  mark_messages_as_read: {
    method: "markMessagesAsRead",
    kind: "view",
    args: (a) => ({ channel: optStr(a.channel), timestamp: optU64(a.timestamp) }),
    result: same,
  },
  mark_as_read: {
    method: "markAsRead",
    kind: "call",
    args: (a) => ({ timestamp: u64(a.timestamp) }),
    result: same,
  },
  get_unread_count: { method: "getUnreadCount", kind: "view", args: none, result: num },
  get_unread_mentions: { method: "getUnreadMentions", kind: "view", args: none, result: num },
  update_info: {
    method: "updateInfo",
    kind: "call",
    args: (a) => ({ name: optStr(a.name), description: optStr(a.description) }),
    result: same,
  },
  set_profile: {
    method: "setProfile",
    kind: "call",
    args: (a) => ({ username: String(a.username ?? ""), avatar: optStr(a.avatar) }),
    result: same,
  },
  get_profiles: {
    method: "getProfiles",
    kind: "view",
    args: none,
    result: (r) =>
      (Array.isArray(r) ? (r as Rec[]) : []).map((p) => ({
        identity: String(p.identity ?? ""),
        username: String(p.username ?? ""),
        avatar: optStr(p.avatar),
      })),
  },
  save_draft: {
    method: "saveDraft",
    kind: "call",
    args: (a) => ({ channel: String(a.channel ?? ""), text: String(a.text ?? "") }),
    result: same,
  },
  get_draft: {
    method: "getDraft",
    kind: "view",
    args: (a) => ({ channel: String(a.channel ?? "") }),
    result: (r) => (typeof r === "string" ? r : ""),
  },
  delete_draft: {
    method: "deleteDraft",
    kind: "call",
    args: (a) => ({ channel: String(a.channel ?? "") }),
    result: same,
  },
  get_member_role: {
    method: "getMemberRole",
    kind: "view",
    args: (a) => ({ identity: String(a.identity ?? "") }),
    result: same,
  },
  list_roles: { method: "listRoles", kind: "view", args: none, result: same },
  set_member_role: {
    method: "setMemberRole",
    kind: "call",
    args: (a) => ({ target: String(a.target ?? ""), role: a.role }),
    result: same,
  },
  send_message: {
    method: "sendMessage",
    kind: "call",
    args: (a) => ({
      message: String(a.message ?? ""),
      mentions: Array.isArray(a.mentions) ? a.mentions : [],
      mentionsUsernames: Array.isArray(a.mentions_usernames)
        ? a.mentions_usernames
        : Array.isArray(a.usernames)
          ? a.usernames
          : [],
      parentMessage: optStr(a.parent_message),
      timestamp: u64(a.timestamp),
      files: attachmentsIn(a.files),
      images: attachmentsIn(a.images),
    }),
    result: (r) => messageOut((r ?? {}) as Rec),
  },
  get_messages: {
    method: "getMessages",
    kind: "view",
    args: (a) => ({
      parentMessage: optStr(a.parent_message),
      limit: optInt(a.limit),
      offset: optInt(a.offset),
      searchTerm: optStr(a.search_term),
    }),
    result: fullOut,
  },
  get_messages_from: {
    method: "getMessagesFrom",
    kind: "view",
    args: (a) => ({ start: u64(a.start), limit: optInt(a.limit) }),
    result: fullOut,
  },
  get_message_count: { method: "getMessageCount", kind: "view", args: none, result: num },
  search_messages: {
    method: "searchMessages",
    kind: "view",
    args: (a) => ({ query: String(a.query ?? ""), cursor: optStr(a.cursor), limit: optInt(a.limit) }),
    result: searchOut,
  },
  search_messages_scan: {
    method: "searchMessagesScan",
    kind: "view",
    args: (a) => ({ query: String(a.query ?? ""), cursor: optStr(a.cursor), limit: optInt(a.limit) }),
    result: searchOut,
  },
  message_position: {
    method: "messagePosition",
    kind: "view",
    args: (a) => ({ messageId: String(a.message_id ?? "") }),
    result: (r) => optNum(r),
  },
  update_reaction: {
    method: "updateReaction",
    kind: "call",
    args: (a) => ({ messageId: String(a.message_id ?? ""), emoji: String(a.emoji ?? ""), add: Boolean(a.add) }),
    result: same,
  },
  edit_message: {
    method: "editMessage",
    kind: "call",
    args: (a) => ({
      messageId: String(a.message_id ?? ""),
      newMessage: String(a.new_message ?? ""),
      timestamp: u64(a.timestamp),
      parentId: optStr(a.parent_id),
    }),
    result: (r) => messageOut((r ?? {}) as Rec),
  },
  delete_message: {
    method: "deleteMessage",
    kind: "call",
    args: (a) => ({ messageId: String(a.message_id ?? ""), parentId: optStr(a.parent_id) }),
    result: same,
  },
};

// ── calls ────────────────────────────────────────────────────────────────────

/** A refusal in v1's words: the `message` field the contract's error carries. */
export class ChatError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly appCode?: string,
  ) {
    super(message);
    this.name = "ChatError";
  }
}

/** The text a refusal shows: the contract's own message where it gave one. */
export function errorMessage(e: unknown): string {
  if (e instanceof AppError) {
    const m = e.fields?.message;
    if (typeof m === "string" && m) return m;
    const fields = Object.keys(e.fields ?? {}).length ? ` ${JSON.stringify(e.fields)}` : "";
    return `${e.appCode}${fields}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Runs v1 method `name` with v1 arguments in app instance `app`, and answers
 * what v1 answered. A method the contract does not have is refused like v1
 * refused one (`Method not found`).
 */
export async function execute<T>(
  app: string,
  name: string,
  v1Args: Args = {},
  client: Pick<CalimeroClient, "call" | "view"> = getClient(),
): Promise<T> {
  const spec = METHODS[name];
  if (!spec) throw new ChatError(`Method not found: ${name}`, -32601);
  if (!app) throw new ChatError("No conversation is open.", 400);
  const args = spec.args(v1Args ?? {});
  try {
    const out =
      spec.kind === "call"
        ? await client.call(app, spec.method, args)
        : await client.view(app, spec.method, args);
    return spec.result(out.result) as T;
  } catch (e) {
    const status = (e as { status?: unknown })?.status;
    throw new ChatError(
      errorMessage(e),
      typeof status === "number" ? status : 500,
      e instanceof AppError ? e.appCode : undefined,
    );
  } finally {
    after();
  }
}
