import {
  type ApiResponse,
  WsSubscriptionsClient,
  getAppEndpointKey,
  getContextId,
  getExecutorPublicKey,
  rpcClient,
  getAuthConfig,
} from "@calimero-network/calimero-client";
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
  type InviteToChannelProps,
  type JoinChannelProps,
  type JoinChatProps,
  type LeaveChannelProps,
  type Message,
  type SendMessageProps,
  type UpdateInvitationPayloadProps,
  type UpdateNewIdentityProps,
  type UpdateReactionProps,
  type UserId,
} from "../clientApi";
import { getDmContextId } from "../../utils/session";

export function getJsonRpcClient() {
  const appEndpointKey = getAppEndpointKey();
  if (!appEndpointKey) {
    throw new Error(
      "Application endpoint key is missing. Please check your configuration."
    );
  }
  return rpcClient;
}

export function getWsSubscriptionsClient() {
  const appEndpointKey = getAppEndpointKey();
  if (!appEndpointKey) {
    throw new Error(
      "Application endpoint key is missing. Please check your configuration."
    );
  }
  return new WsSubscriptionsClient(appEndpointKey, "/ws");
}

export class ClientApiDataSource implements ClientApi {
  async joinChat(props: JoinChatProps): ApiResponse<string> {
    try {
      const auth = getAuthConfig();
      console.log("auth config", auth);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: (props.isDM ? getDmContextId() : getContextId()) || "",
          method: ClientMethod.JOIN_CHAT,
          argsJson: {},
          executorPublicKey:
            (props.isDM ? props.executor : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
    props: CreateChannelProps
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
        }
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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

  async getChannelInfo(props: GetChannelInfoProps): ApiResponse<ChannelInfo> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, ChannelInfo>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_CHANNEL_INFO,
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
      }
      return {
        data: response?.result.output as ChannelInfo,
        error: null,
      };
    } catch (error) {
      console.error("getChannelInfo failed:", error);
      let errorMessage = "An unexpected error occurred during getChannelInfo";
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

  async getChannelMembers(
    props: GetChannelMembersProps
  ): ApiResponse<UserId[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, UserId[]>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_CHANNEL_MEMBERS,
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
      }

      return {
        data: response?.result.output as UserId[],
        error: null,
      };
    } catch (error) {
      console.error("getChannelMembers failed:", error);
      let errorMessage =
        "An unexpected error occurred during getChannelMembers";
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
    props: GetNonMemberUsersProps
  ): ApiResponse<UserId[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, UserId[]>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.GET_INVITE_USERS,
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
      }
      return {
        data: response?.result.output as UserId[],
        error: null,
      };
    } catch (error) {
      console.error("getNonMemberUsers failed:", error);
      let errorMessage =
        "An unexpected error occurred during getNonMemberUsers";
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        FullMessageResponse
      >(
        {
          contextId: (props.is_dm ? getDmContextId() : getContextId()) || "",
          method: ClientMethod.GET_MESSAGES,
          argsJson: {
            group: props.group,
            parent_message: props.parent_message,
            limit: props.limit,
            offset: props.offset,
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
          contextId: (props.is_dm ? getDmContextId() : getContextId()) || "",
          method: ClientMethod.SEND_MESSAGE,
          argsJson: {
            group: props.group,
            message: props.message,
            parent_message: props.parent_message,
            timestamp: props.timestamp,
          },
          executorPublicKey:
            (props.is_dm ? props.dm_identity : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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

  async getChatMembers(props: GetChatMembersProps): ApiResponse<UserId[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, UserId[]>(
        {
          contextId: (props.isDM ? getDmContextId() : getContextId()) || "",
          method: ClientMethod.GET_CHAT_MEMBERS,
          argsJson: {},
          executorPublicKey:
            (props.isDM ? props.executor : getExecutorPublicKey()) || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
      }
      return {
        data: response?.result.output as UserId[],
        error: null,
      };
    } catch (error) {
      console.error("getChatMembers failed:", error);
      let errorMessage = "An unexpected error occurred during getChatMembers";
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

  async createDm(props: CreateDmProps): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.CREATE_DM,
          argsJson: {
            context_id: props.context_id,
            creator: props.creator,
            creator_new_identity: props.creator_new_identity,
            invitee: props.invitee,
            timestamp: props.timestamp,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
            group: props.group,
            message_id: props.messageId,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
            group: props.group,
            message_id: props.messageId,
            new_message: props.newMessage,
            timestamp: props.timestamp,
          },
          executorPublicKey: getExecutorPublicKey() || "",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
    props: UpdateInvitationPayloadProps
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
        }
      );
      if (response?.error) {
        return {
          data: null,
          error: {
            code: response?.error.code,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            message: (response?.error.error.cause.info as any).message,
          },
        }
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
}
