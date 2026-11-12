/**
 * The chat contract, through `MeroChatClient` (`src/generated/client.ts`, which
 * `mero-app-build codegen` writes from `logic/res/abi.json`).
 *
 * The screens and `ClientApiDataSource` still speak v1: snake_case method
 * names (`send_message`), snake_case arguments and answers, numbers for
 * timestamps. The component ABI (`logic/res/abi.json`) names methods and
 * fields in camelCase and sends 64-bit integers as decimal strings. This file
 * is the one place that knows both: `execute(app, "send_message", {...})`
 * answers exactly what v1 answered, so nothing above it changes.
 *
 * The ABI names its records without their shapes, so the generated types are
 * `unknown`; the `result` of each entry turns an answer back into v1's.
 * `client.test.ts` checks the generated client against the committed ABI, and
 * `meroChat.test.ts` that this table covers it.
 */
import { AppError } from "@calimero-network/mero-js";

import { after, getClient } from "./calimero";
import { MeroChatClient, type AppTransport } from "../generated/client";

type Args = Record<string, unknown>;
type Out = unknown;

interface MethodSpec {
  /** v1 arguments → the generated client's method, with the ABI's (camelCase, u64 as decimal strings). */
  run: (c: MeroChatClient, a: Args) => Promise<Out>;
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

// ── the method table: v1 name → ABI ──────────────────────────────────────────

export const METHODS: Record<string, MethodSpec> = {
  get_info: { run: (c) => c.getInfo(), result: infoOut },
  get_channel_info: {
    run: (c, a) => c.getChannelInfo({ channel: optStr(a.channel) }),
    result: infoOut,
  },
  mark_messages_as_read: {
    run: (c, a) => c.markMessagesAsRead({ channel: optStr(a.channel), timestamp: optU64(a.timestamp) }),
    result: same,
  },
  mark_as_read: {
    run: (c, a) => c.markAsRead({ timestamp: u64(a.timestamp) }),
    result: same,
  },
  get_unread_count: { run: (c) => c.getUnreadCount(), result: num },
  get_unread_mentions: { run: (c) => c.getUnreadMentions(), result: num },
  update_info: {
    run: (c, a) => c.updateInfo({ name: optStr(a.name), description: optStr(a.description) }),
    result: same,
  },
  set_profile: {
    run: (c, a) => c.setProfile({ username: String(a.username ?? ""), avatar: optStr(a.avatar) }),
    result: same,
  },
  get_profiles: {
    run: (c) => c.getProfiles(),
    result: (r) =>
      (Array.isArray(r) ? (r as Rec[]) : []).map((p) => ({
        identity: String(p.identity ?? ""),
        username: String(p.username ?? ""),
        avatar: optStr(p.avatar),
      })),
  },
  save_draft: {
    run: (c, a) => c.saveDraft({ channel: String(a.channel ?? ""), text: String(a.text ?? "") }),
    result: same,
  },
  get_draft: {
    run: (c, a) => c.getDraft({ channel: String(a.channel ?? "") }),
    result: (r) => (typeof r === "string" ? r : ""),
  },
  delete_draft: {
    run: (c, a) => c.deleteDraft({ channel: String(a.channel ?? "") }),
    result: same,
  },
  get_member_role: {
    run: (c, a) => c.getMemberRole({ identity: String(a.identity ?? "") }),
    result: same,
  },
  list_roles: { run: (c) => c.listRoles(), result: same },
  set_member_role: {
    run: (c, a) => c.setMemberRole({ target: String(a.target ?? ""), role: a.role }),
    result: same,
  },
  send_message: {
    run: (c, a) => c.sendMessage({
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
    run: (c, a) => c.getMessages({
      parentMessage: optStr(a.parent_message),
      limit: optInt(a.limit),
      offset: optInt(a.offset),
      searchTerm: optStr(a.search_term),
    }),
    result: fullOut,
  },
  get_messages_from: {
    run: (c, a) => c.getMessagesFrom({ start: u64(a.start), limit: optInt(a.limit) }),
    result: fullOut,
  },
  get_message_count: { run: (c) => c.getMessageCount(), result: num },
  search_messages: {
    run: (c, a) => c.searchMessages({ query: String(a.query ?? ""), cursor: optStr(a.cursor), limit: optInt(a.limit) }),
    result: searchOut,
  },
  search_messages_scan: {
    run: (c, a) => c.searchMessagesScan({ query: String(a.query ?? ""), cursor: optStr(a.cursor), limit: optInt(a.limit) }),
    result: searchOut,
  },
  message_position: {
    run: (c, a) => c.messagePosition({ messageId: String(a.message_id ?? "") }),
    result: (r) => optNum(r),
  },
  update_reaction: {
    run: (c, a) => c.updateReaction({ messageId: String(a.message_id ?? ""), emoji: String(a.emoji ?? ""), add: Boolean(a.add) }),
    result: same,
  },
  edit_message: {
    run: (c, a) => c.editMessage({
      messageId: String(a.message_id ?? ""),
      newMessage: String(a.new_message ?? ""),
      timestamp: u64(a.timestamp),
      parentId: optStr(a.parent_id),
    }),
    result: (r) => messageOut((r ?? {}) as Rec),
  },
  delete_message: {
    run: (c, a) => c.deleteMessage({ messageId: String(a.message_id ?? ""), parentId: optStr(a.parent_id) }),
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
  client: AppTransport = getClient(),
): Promise<T> {
  const spec = METHODS[name];
  if (!spec) throw new ChatError(`Method not found: ${name}`, -32601);
  if (!app) throw new ChatError("No conversation is open.", 400);
  try {
    // `after` runs below, once, as it always has: the class is built without one.
    const out = await spec.run(new MeroChatClient(client, app), v1Args ?? {});
    return spec.result(out) as T;
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
