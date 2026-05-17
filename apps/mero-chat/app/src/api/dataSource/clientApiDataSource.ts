import {
  getContextId,
  getContextIdentity as getExecutorPublicKey,

} from "@calimero-network/mero-react";
import type { ExecuteParams } from "@calimero-network/mero-js";
import type { ApiResponse } from "../types";
import { rpcExec } from "../meroJsClient";
import {
  type AcceptInvitationProps,
  type ChannelInfo,
  type Channels,
  type ClientApi,
  ClientMethod,
  type CreateChannelProps,
  type CreateChannelResponse,
  type CreateDmProps,
  type DeleteDMProps,
  type DeleteMessageProps,
  type DMChatInfo,
  type EditMessageProps,
  type FullMessageResponse,
  type GetChannelInfoProps,
  type GetChannelMembersProps,
  type GetChatMembersProps,
  type GetMessagesProps,
  type GetNonMemberUsersProps,
  type GetUsernameProps,
  type InviteToChannelProps,
  type JoinChannelProps,
  type JoinChatProps,
  type LeaveChannelProps,
  type MarkAsReadProps,
  type GetUnreadProps,
  type Message,
  type ReadDmProps,
  type ReadMessageProps,
  type SendMessageProps,
  type SetMemberRoleProps,
  type GetMemberRoleProps,
  type ListRolesProps,
  type MemberRoleEntry,
  type Role,
  type UpdateInvitationPayloadProps,
  type UpdateNewIdentityProps,
  type UpdateReactionProps,
  type UserId,
  type SearchAllMessagesProps,
} from "../clientApi";
import { getMessengerDisplayName } from "../../utils/messengerName";

// Backward-compat shim: dataSource code calls
//   getJsonRpcClient().execute<any, T>(params, config)
// which now routes through mero-js via our rpcExec wrapper. The wrapper
// rebuilds the legacy `{ result: { output }, error: { code, error: { cause: { info: { message } } } } }`
// envelope so callsites don't need touching.
export function getJsonRpcClient() {
  return {
    execute: <_Args, T>(params: ExecuteParams, _config?: unknown) =>
      rpcExec<T>(params, _config),
  };
}

export class ClientApiDataSource implements ClientApi {
  async joinChat(props: JoinChatProps): ApiResponse<string> {
    try {
      if (!props.username?.trim()) {
        return {
          data: null,
          error: {
            code: 400,
            message: "Username is required",
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: props.contextId || getContextId() || "",
          method: "set_profile",
          argsJson: {
            username: props.username.trim(),
            avatar: null,
          },
          executorPublicKey:
            (props.isDM ? props.executor : (props.executorPublicKey || getExecutorPublicKey())) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("joinChat failed:", error);
      let errorMessage = "An unexpected error occurred during joinChat";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async createChannel(
    props: CreateChannelProps,
  ): ApiResponse<CreateChannelResponse> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        CreateChannelResponse
      >(
        {
          contextId: getContextId() || "",
          method: ClientMethod.CREATE_CHANNEL,
          argsJson: {
            channel: props.channel,
            channel_type: props.channel_type,
            read_only: props.read_only,
            moderators: props.moderators,
            links_allowed: props.links_allowed,
            created_at: props.created_at,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }

      return {
        data: response?.result.output as CreateChannelResponse,
        error: null,
      };
    } catch (error) {
      console.error("createChannel failed:", error);
      let errorMessage = "An unexpected error occurred during createChannel";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getChannels(): ApiResponse<Channels> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, Channels>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_CHANNELS,
          argsJson: {},
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }

      return {
        data: response?.result.output as Channels,
        error: null,
      };
    } catch (error) {
      console.error("getChannels failed:", error);
      let errorMessage = "An unexpected error occurred during getChannels";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getAllChannelsSearch(): ApiResponse<Channels> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, Channels>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_ALL_CHANNELS_SEARCH,
          argsJson: {},
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as Channels,
        error: null,
      };
    } catch (error) {
      console.error("getAllChannelsSearch failed:", error);
      let errorMessage =
        "An unexpected error occurred during getAllChannelsSearch";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getChannelInfo(_props: GetChannelInfoProps): ApiResponse<ChannelInfo> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, {
        name: string; context_type: string; description: string;
        created_at: number; creator: string;
      }>(
        {
          contextId: getContextId() || "",
          method: "get_info",
          argsJson: {},
          executorPublicKey: getExecutorPublicKey() || "",
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 },
      );
      if (response?.error) {
        return { data: null, error: { code: response.error.code, message: "get_info failed" } };
      }
      const out = response?.result.output;
      return {
        data: {
          channel_type: out?.context_type ?? "",
          created_at: out?.created_at ?? 0,
          created_by: out?.creator ?? "",
          created_by_username: "",
          links_allowed: true,
          read_only: false,
          unread_count: 0,
          unread_mentions: 0,
        },
        error: null,
      };
    } catch {
      return { data: null, error: { code: 500, message: "get_info failed" } };
    }
  }

  async getChannelMembers(
    _props: GetChannelMembersProps,
  ): ApiResponse<Map<string, string>> {
    try {
      const contextId = getContextId() || "";
      const executorPublicKey = getExecutorPublicKey() || "";
      if (!contextId || !executorPublicKey) return { data: new Map(), error: null };
      const profilesRes = await this.getProfiles(contextId, executorPublicKey);
      const memberMap = new Map<string, string>();
      for (const p of profilesRes.data ?? []) {
        if (p.identity && p.username) memberMap.set(p.identity, p.username);
      }
      return { data: memberMap, error: null };
    } catch {
      return { data: new Map(), error: null };
    }
  }

  async inviteToChannel(props: InviteToChannelProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.INVITE_TO_CHANNEL,
          argsJson: {
            channel: props.channel,
            user: props.user,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("inviteToChannel failed:", error);
      let errorMessage = "An unexpected error occurred during inviteToChannel";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getNonMemberUsers(
    _props: GetNonMemberUsersProps,
  ): ApiResponse<UserId[]> {
    // get_non_member_users does not exist in the WASM contract.
    // Return empty — the invite flow degrades gracefully.
    return { data: [], error: null };
  }

  async joinChannel(props: JoinChannelProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.JOIN_CHANNEL,
          argsJson: {
            channel: props.channel,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("joinChannel failed:", error);
      let errorMessage = "An unexpected error occurred during joinChannel";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async leaveChannel(props: LeaveChannelProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.LEAVE_CHANNEL,
          argsJson: {
            channel: props.channel,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("leaveChannel failed:", error);
      let errorMessage = "An unexpected error occurred during leaveChannel";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getMessages(props: GetMessagesProps): ApiResponse<FullMessageResponse> {
    try {
      const useContext = props.refetch_context_id ? props.refetch_context_id : getContextId() || "";
      const useIdentity = props.refetch_identity ? props.refetch_identity : (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "";
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        FullMessageResponse
      >(
        {
          contextId: useContext,
          method: ClientMethod.GET_MESSAGES,
          argsJson: {
            group: props.group,
            parent_message: props.parent_message,
            limit: props.limit,
            offset: props.offset,
            ...(props.search_term
              ? { search_term: props.search_term }
              : {}),
          },
          executorPublicKey: useIdentity,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }

      return {
        data: response?.result.output as FullMessageResponse,
        error: null,
      };
    } catch (error) {
      console.error("getMessages failed:", error);
      let errorMessage = "An unexpected error occurred during getMessages";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async searchAllMessages(props: SearchAllMessagesProps): ApiResponse<FullMessageResponse> {
    try {
      const contextId = props.contextId ?? getContextId() ?? "";
      const executorPublicKey = props.executorPublicKey ?? getExecutorPublicKey() ?? "";
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        FullMessageResponse
      >(
        {
          contextId,
          method: ClientMethod.SEARCH_ALL_MESSAGES,
          argsJson: {
            search_term: props.search_term,
            ...(props.limit !== undefined ? { limit: props.limit } : {}),
            ...(props.offset !== undefined ? { offset: props.offset } : {}),
          },
          executorPublicKey,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as FullMessageResponse,
        error: null,
      };
    } catch (error) {
      let errorMessage = "An unexpected error occurred during searchAllMessages";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: { code: 500, message: errorMessage },
      };
    }
  }

  async sendMessage(props: SendMessageProps): ApiResponse<Message> {
    try {
      if (!props.message) {
        return {
          error: {
            code: 400,
            message: "Message is required",
          },
        };
      }
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        Message
      >(
        {
          contextId: getContextId() || "",
          method: ClientMethod.SEND_MESSAGE,
          argsJson: {
            group: props.group,
            message: props.message,
            mentions: props.mentions,
            mentions_usernames: props.usernames,
            parent_message: props.parent_message,
            timestamp: props.timestamp,
            sender_username: getMessengerDisplayName(),
            ...(props.files && props.files.length > 0
              ? { files: props.files }
              : {}),
            ...(props.images && props.images.length > 0
              ? { images: props.images }
              : {}),
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }

      return {
        data: response?.result.output as Message,
        error: null,
      };
    } catch (error) {
      console.error("sendMessage failed:", error);
      let errorMessage = "An unexpected error occurred during sendMessage";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }


  async getDms(): ApiResponse<DMChatInfo[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, DMChatInfo[]>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_DMS,
          argsJson: {},
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as DMChatInfo[],
        error: null,
      };
    } catch (error) {
      console.error("getDms failed:", error);
      let errorMessage = "An unexpected error occurred during getDms";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getChatMembers(
    props: GetChatMembersProps,
  ): ApiResponse<Map<string, string>> {
    try {
      const contextId = getContextId() || "";
      const executorPublicKey = (props.isDM ? props.executor : getExecutorPublicKey()) || "";
      if (!contextId || !executorPublicKey) return { data: new Map(), error: null };
      const profilesRes = await this.getProfiles(contextId, executorPublicKey);
      const memberMap = new Map<string, string>();
      for (const p of profilesRes.data ?? []) {
        if (p.identity && p.username) memberMap.set(p.identity, p.username);
      }
      return { data: memberMap, error: null };
    } catch {
      return { data: new Map(), error: null };
    }
  }

  async createDm(props: CreateDmProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.CREATE_DM,
          argsJson: {
            context_id: props.context_id,
            context_hash: props.context_hash,
            creator: props.creator,
            creator_new_identity: props.creator_new_identity,
            invitee: props.invitee,
            timestamp: props.timestamp,
            invitation_payload: props.payload,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("createDm failed:", error);
      let errorMessage = "An unexpected error occurred during createDm";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async updateReaction(props: UpdateReactionProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.UPDATE_REACTION,
          argsJson: {
            message_id: props.messageId,
            emoji: props.emoji,
            user: props.userId,
            add: props.add,
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("updateReaction failed:", error);
      let errorMessage = "An unexpected error occurred during updateReaction";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async deleteMessage(props: DeleteMessageProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.DELETE_MESSAGE,
          argsJson: {
            group: props.is_dm ? { name: "private_dm" } : props.group,
            message_id: props.messageId,
            parent_id: props.parent_id,
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("deleteMessage failed:", error);
      let errorMessage = "An unexpected error occurred during deleteMessage";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async editMessage(props: EditMessageProps): ApiResponse<Message> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, Message>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.EDIT_MESSAGE,
          argsJson: {
            group: props.is_dm ? { name: "private_dm" } : props.group,
            message_id: props.messageId,
            new_message: props.newMessage,
            timestamp: props.timestamp,
            parent_id: props.parent_id,
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as Message,
        error: null,
      };
    } catch (error) {
      console.error("editMessage failed:", error);
      let errorMessage = "An unexpected error occurred during editMessage";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async updateNewIdentity(props: UpdateNewIdentityProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.UPDATE_NEW_IDENTITY,
          argsJson: {
            other_user: props.other_user,
            new_identity: props.new_identity,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("updateNewIdentity failed:", error);
      let errorMessage =
        "An unexpected error occurred during updateNewIdentity";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async updateInvitationPayload(
    props: UpdateInvitationPayloadProps,
  ): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.UPDATE_INVITATION_PAYLOAD,
          argsJson: {
            other_user: props.other_user,
            invitation_payload: props.invitation_payload,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("updateInvitationPayload failed:", error);
      let errorMessage =
        "An unexpected error occurred during updateInvitationPayload";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async acceptInvitation(props: AcceptInvitationProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.ACCEPT_INVITATION,
          argsJson: {
            other_user: props.other_user,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("acceptInvitation failed:", error);
      let errorMessage = "An unexpected error occurred during acceptInvitation";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async deleteDM(props: DeleteDMProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.DELETE_DM,
          argsJson: {
            other_user: props.other_user,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("deleteDM failed:", error);
      let errorMessage = "An unexpected error occurred during deleteDM";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async readMessage(props: ReadMessageProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.READ_MESSAGE,
          argsJson: {
            channel: props.channel,
            timestamp: props.timestamp,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("readMessage failed:", error);
      let errorMessage = "An unexpected error occurred during readMessage";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }


  async readDm(props: ReadDmProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.READ_DM,
          argsJson: {
            other_user_id: props.other_user_id,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return {
        data: response?.result.output as string,
        error: null,
      };
    } catch (error) {
      console.error("readDM failed:", error);
      let errorMessage = "An unexpected error occurred during readDM";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  async getUsername(props: GetUsernameProps): ApiResponse<string> {
    try {
      const response = await getJsonRpcClient().execute<
        Record<string, never>,
        { identity: string; username: string; avatar?: string }[]
      >(
        {
          contextId: props.contextId || getContextId() || "",
          method: "get_profiles",
          argsJson: {},
          executorPublicKey: props.executorPublicKey || getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }

      const profiles = Array.isArray(response?.result?.output)
        ? response.result.output
        : [];
      const match = profiles.find((profile) => profile.identity === props.userId);
      if (!match) {
        return {
          data: null,
          error: {
            code: 404,
            message: "Username not found for this identity",
          },
        };
      }

      return {
        data: match.username,
        error: null,
      };
    } catch (error) {
      console.error("getUsername failed:", error);
      let errorMessage = "An unexpected error occurred during getUsername";
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === "string") {
        errorMessage = error;
      }
      return {
        data: null,
        error: {
          code: 500,
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Call `get_info()` on a specific context to retrieve its metadata.
   * Used by the group-based channel list to get name/type/description per context.
   */
  async getContextInfo(
    contextId: string,
    executorPublicKey: string,
  ): ApiResponse<import("../../types/Common").ContextInfo> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        import("../../types/Common").ContextInfo
      >(
        {
          contextId,
          method: "get_info",
          argsJson: {},
          executorPublicKey,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code,
            message:
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (response.error.error?.cause?.info as any)?.message ??
              "get_info RPC failed",
          },
        };
      }

      return {
        data: response?.result.output as import("../../types/Common").ContextInfo,
        error: null,
      };
    } catch (error) {
      console.error("getContextInfo failed:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during getContextInfo";
      return {
        data: null,
        error: { code: 500, message: errorMessage },
      };
    }
  }

  async getProfiles(
    contextId: string,
    executorPublicKey: string,
  ): ApiResponse<{ identity: string; username: string; avatar?: string }[]> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        { identity: string; username: string; avatar?: string }[]
      >(
        {
          contextId,
          method: "get_profiles",
          argsJson: {},
          executorPublicKey,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response.error.code,
            message:
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (response.error.error?.cause?.info as any)?.message ??
              "get_profiles RPC failed",
          },
        };
      }

      return {
        data: response?.result.output as { identity: string; username: string; avatar?: string }[],
        error: null,
      };
    } catch (error) {
      console.error("getProfiles failed:", error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : "An unexpected error occurred during getProfiles";
      return {
        data: null,
        error: { code: 500, message: errorMessage },
      };
    }
  }

  // ── Moderation: in-WASM role + ban gate ───────────────────────────────────

  async setMemberRole(props: SetMemberRoleProps): ApiResponse<string> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        string
      >(
        {
          contextId: props.contextId,
          method: ClientMethod.SET_MEMBER_ROLE,
          argsJson: { target: props.target, role: props.role },
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return { data: response?.result.output as string, error: null };
    } catch (error) {
      console.error("setMemberRole failed:", error);
      const message =
        error instanceof Error ? error.message : "setMemberRole failed";
      return { data: null, error: { code: 500, message } };
    }
  }

  async getMemberRole(props: GetMemberRoleProps): ApiResponse<Role> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        Role
      >(
        {
          contextId: props.contextId,
          method: ClientMethod.GET_MEMBER_ROLE,
          argsJson: { identity: props.identity },
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      return { data: response?.result.output as Role, error: null };
    } catch (error) {
      console.error("getMemberRole failed:", error);
      const message =
        error instanceof Error ? error.message : "getMemberRole failed";
      return { data: null, error: { code: 500, message } };
    }
  }

  async listRoles(props: ListRolesProps): ApiResponse<MemberRoleEntry[]> {
    try {
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        // WASM returns Vec<(UserId, Role)> serialised as a tuple-array.
        Array<[string, Role]>
      >(
        {
          contextId: props.contextId,
          method: ClientMethod.LIST_ROLES,
          argsJson: {},
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 10000 },
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        };
      }
      const tuples = (response?.result.output as Array<[string, Role]>) ?? [];
      const data: MemberRoleEntry[] = tuples.map(([identity, role]) => ({
        identity,
        role,
      }));
      return { data, error: null };
    } catch (error) {
      console.error("listRoles failed:", error);
      const message =
        error instanceof Error ? error.message : "listRoles failed";
      return { data: null, error: { code: 500, message } };
    }
  }

  async markAsRead(props: MarkAsReadProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: props.contextId,
          method: ClientMethod.MARK_AS_READ,
          argsJson: { timestamp: props.timestamp },
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 5000 },
      );
      if (response?.error) {
        return { data: null, error: { code: response.error.code, message: "mark_as_read failed" } };
      }
      return { data: response?.result.output as string, error: null };
    } catch {
      return { data: null, error: { code: 500, message: "mark_as_read failed" } };
    }
  }

  async getUnreadCount(props: GetUnreadProps): ApiResponse<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, number>(
        {
          contextId: props.contextId,
          method: ClientMethod.GET_UNREAD_COUNT,
          argsJson: {},
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 5000 },
      );
      if (response?.error) {
        return { data: 0, error: null };
      }
      return { data: (response?.result.output as number) ?? 0, error: null };
    } catch {
      return { data: 0, error: null };
    }
  }

  async getUnreadMentions(props: GetUnreadProps): ApiResponse<number> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, number>(
        {
          contextId: props.contextId,
          method: ClientMethod.GET_UNREAD_MENTIONS,
          argsJson: {},
          executorPublicKey: props.executorPublicKey,
        },
        { headers: { "Content-Type": "application/json" }, timeout: 5000 },
      );
      if (response?.error) {
        return { data: 0, error: null };
      }
      return { data: (response?.result.output as number) ?? 0, error: null };
    } catch {
      return { data: 0, error: null };
    }
  }
}
