import { describeError } from "@calimero-apps/connect";

import { chat, type Chat, type Profile } from "../../calimero/chat";
import { connection, getActiveApp, selfAccount } from "../../calimero/connection";
import { accountsOf, workspaceMembers } from "../../calimero/registry";
import { nameRepository } from "../../repositories/names/useNames";
import type { ApiResponse, ResponseData } from "../types";
import type {
  ChannelInfo,
  ClientApi,
  DeleteMessageProps,
  EditMessageProps,
  FullMessageResponse,
  GetChannelInfoProps,
  GetChannelMembersProps,
  GetChatMembersProps,
  GetMessageCountProps,
  GetMessagesFromProps,
  GetMessagesProps,
  GetNonMemberUsersProps,
  GetUnreadProps,
  GetUsernameProps,
  ListRolesProps,
  MarkAsReadProps,
  MemberRoleEntry,
  Message,
  MessagePositionProps,
  ReadMessageProps,
  SearchAllMessagesProps,
  SearchMessagesProps,
  SearchPage,
  SendMessageProps,
  SetMemberRoleProps,
  UpdateReactionProps,
  UserId,
} from "../clientApi";

/** Pages a listing (profiles, roles) is followed through before it stops. */
const MAX_LIST_PAGES = 10;

/** The conversation `app` (the open one by default) through the signed-in client. */
export function chatOf(app?: string | null): Chat {
  const conn = connection();
  const id = app || getActiveApp();
  if (!id) throw new Error("No conversation is open.");
  return chat(conn.client, id, conn.after);
}

async function wrap<T>(run: () => Promise<T>): ApiResponse<T> {
  try {
    return { data: await run(), error: null };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { data: null, error: { code: status ?? 500, message: describeError(e) } };
  }
}

/** Every page of a listing, up to `MAX_LIST_PAGES`: the adapter follows `next`. */
export async function allPages<T>(
  page: (cursor: string | null) => Promise<{ items: T[]; next: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < MAX_LIST_PAGES; i++) {
    const p = await page(cursor);
    out.push(...p.items);
    if (!p.next) break;
    cursor = p.next;
  }
  return out;
}

/** Every profile in `app`. */
export function profilesOf(app?: string | null): Promise<Profile[]> {
  const c = chatOf(app);
  return allPages((cursor) => c.getProfiles(cursor, 1000));
}

/**
 * The contract, in the shapes the screens were written for (v1's
 * `ResponseData`, snake_case fields, numbers): each method is one call or view
 * of `calimero/chat.ts` on the conversation named by `contextId`, else the open
 * one. The v1 `executorPublicKey` / `dm_identity` arguments are accepted and
 * ignored: an account is the only identity.
 */
export class ClientApiDataSource implements ClientApi {
  getChannelInfo(props?: GetChannelInfoProps & { contextId?: string }): ApiResponse<ChannelInfo> {
    return wrap(async () => {
      const info = await chatOf(props?.contextId).getInfo();
      return {
        channel_type: info.contextType,
        created_at: Number(info.createdAt),
        created_by: info.creator,
        links_allowed: true,
        read_only: false,
        unread_count: 0,
        unread_mentions: 0,
      };
    });
  }

  /** Who reaches the conversation, by display name. */
  getChannelMembers(_props?: GetChannelMembersProps): ApiResponse<Map<string, string>> {
    return wrap(async () => {
      const out = new Map<string, string>();
      await Promise.all(
        accountsOf(getActiveApp()).map(async (a) => {
          out.set(a, await nameRepository.resolve(a));
        }),
      );
      return out;
    });
  }

  /** Workspace members a private channel does not reach yet (invite candidates). */
  getNonMemberUsers(_props?: GetNonMemberUsersProps): ApiResponse<UserId[]> {
    return wrap(async () => {
      const inside = new Set(accountsOf(getActiveApp()));
      return workspaceMembers()
        .map((m) => m.account)
        .filter((a) => !inside.has(a));
    });
  }

  /** The profiles written in the conversation: account -> username. */
  getChatMembers(props?: GetChatMembersProps & { contextId?: string }): ApiResponse<Map<string, string>> {
    return wrap(async () => {
      const profiles = await profilesOf(props?.contextId);
      return new Map(profiles.map((p) => [p.identity, p.username] as [string, string]));
    });
  }

  getUsername(props: GetUsernameProps): ApiResponse<string> {
    return wrap(async () => {
      const profiles = await profilesOf(props.contextId);
      const match = profiles.find((p) => p.identity === props.userId);
      if (!match) throw Object.assign(new Error("Username not found for this identity"), { status: 404 });
      return match.username;
    });
  }

  getProfiles(
    contextId: string,
    _executorPublicKey?: string,
  ): ApiResponse<{ identity: string; username: string; avatar?: string }[]> {
    return wrap(async () =>
      (await profilesOf(contextId)).map((p) => ({
        identity: p.identity,
        username: p.username,
        avatar: p.avatar ?? undefined,
      })),
    );
  }

  /** Sets the caller's profile (the username sticks after the first). */
  updateProfile(
    contextId: string,
    _executorPublicKey: string,
    username: string,
    avatar: string | null,
  ): ApiResponse<string> {
    return wrap(() => chatOf(contextId).setProfile(username, avatar));
  }

  getMessagesFrom(props: GetMessagesFromProps): ApiResponse<FullMessageResponse> {
    return wrap(() => chatOf(props.refetch_context_id).getMessagesFrom(props.start, props.limit));
  }

  getMessageCount(props: GetMessageCountProps): ApiResponse<number> {
    return wrap(() => chatOf(props.refetch_context_id).getMessageCount());
  }

  getMessages(props: GetMessagesProps): ApiResponse<FullMessageResponse> {
    return wrap(() =>
      chatOf(props.refetch_context_id).getMessages({
        parentMessage: props.parent_message,
        limit: props.limit,
        offset: props.offset,
        searchTerm: props.search_term,
      }),
    );
  }

  searchMessages(props: SearchMessagesProps): ApiResponse<SearchPage> {
    return wrap(() => chatOf(props.contextId).searchMessages(props.query, props.cursor, props.limit));
  }

  searchMessagesScan(props: SearchMessagesProps): ApiResponse<SearchPage> {
    return wrap(() => chatOf(props.contextId).searchMessagesScan(props.query, props.cursor, props.limit));
  }

  messagePosition(props: MessagePositionProps): ApiResponse<number | null> {
    return wrap(() => chatOf(props.contextId).messagePosition(props.messageId));
  }

  /** A filtered window: `getMessages` with a search term. */
  searchAllMessages(props: SearchAllMessagesProps): ApiResponse<FullMessageResponse> {
    return wrap(() =>
      chatOf(props.contextId).getMessages({
        limit: props.limit,
        offset: props.offset,
        searchTerm: props.search_term,
      }),
    );
  }

  sendMessage(props: SendMessageProps & { contextId?: string }): ApiResponse<Message> {
    return wrap(() =>
      chatOf(props.contextId).sendMessage({
        message: props.message,
        mentions: props.mentions,
        mentionsUsernames: props.usernames,
        parentMessage: props.parent_message,
        timestamp: props.timestamp,
        files: props.files,
        images: props.images,
      }),
    );
  }

  updateReaction(props: UpdateReactionProps & { contextId?: string }): ApiResponse<string> {
    return wrap(() => chatOf(props.contextId).updateReaction(props.messageId, props.emoji, props.add));
  }

  deleteMessage(props: DeleteMessageProps & { contextId?: string }): ApiResponse<string> {
    return wrap(() => chatOf(props.contextId).deleteMessage(props.messageId, props.parent_id));
  }

  editMessage(props: EditMessageProps & { contextId?: string }): ApiResponse<Message> {
    return wrap(() =>
      chatOf(props.contextId).editMessage(props.messageId, props.newMessage, props.timestamp, props.parent_id),
    );
  }

  /** v1's no-op, kept for its callers; `markAsRead` records the position. */
  readMessage(_props: ReadMessageProps): ApiResponse<string> {
    return wrap(() => chatOf().markMessagesAsRead());
  }

  markAsRead(props: MarkAsReadProps): ApiResponse<string> {
    return wrap(() => chatOf(props.contextId).markAsRead(props.timestamp));
  }

  getUnreadCount(props: GetUnreadProps): ApiResponse<number> {
    return wrap(() => chatOf(props.contextId).getUnreadCount());
  }

  getUnreadMentions(props: GetUnreadProps): ApiResponse<number> {
    return wrap(() => chatOf(props.contextId).getUnreadMentions());
  }

  setMemberRole(props: SetMemberRoleProps): ApiResponse<string> {
    return wrap(() => chatOf(props.contextId).setMemberRole(props.target, props.role));
  }

  listRoles(props: ListRolesProps): ApiResponse<MemberRoleEntry[]> {
    return wrap(() => {
      const c = chatOf(props.contextId);
      return allPages((cursor) => c.listRoles(cursor, 1000));
    });
  }

  saveDraft(contextId: string, _executorPublicKey: string, channel: string, text: string): ApiResponse<void> {
    return wrap(async () => {
      await chatOf(contextId).saveDraft(channel, text);
    });
  }

  getDraft(contextId: string, _executorPublicKey: string, channel: string): ApiResponse<string> {
    return wrap(() => chatOf(contextId).getDraft(channel));
  }

  deleteDraft(contextId: string, _executorPublicKey: string, channel: string): ApiResponse<void> {
    return wrap(async () => {
      await chatOf(contextId).deleteDraft(channel);
    });
  }
}

/** Whether `account` is the signed-in account. */
export function isSelf(account: string | undefined | null): boolean {
  return !!account && account === selfAccount();
}

export type { ResponseData };
