import {
  type ApiResponse,
  JsonRpcClient,
  WsSubscriptionsClient,
  type RpcError,
  handleRpcError,
  getAppEndpointKey,
  getContextId,
  getExecutorPublicKey,
} from "@calimero-network/calimero-client";
import {
  type ChannelInfo,
  type Channels,
  type ClientApi,
  ClientMethod,
  type CreateChannelProps,
  type CreateChannelResponse,
  type FullMessageResponse,
  type GetChannelInfoProps,
  type GetChannelMembersProps,
  type GetMessagesProps,
  type GetNonMemberUsersProps,
  type InviteToChannelProps,
  type JoinChannelProps,
  type LeaveChannelProps,
  type Message,
  type SendMessageProps,
  type UserId,
} from "../clientApi";

export function getJsonRpcClient() {
  const appEndpointKey = getAppEndpointKey();
  if (!appEndpointKey) {
    throw new Error(
      "Application endpoint key is missing. Please check your configuration."
    );
  }
  return new JsonRpcClient(appEndpointKey, "/jsonrpc");
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
  private async handleError(
    error: RpcError,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    callbackFunction: any
  ) {
    if (error && error.code) {
      const response = await handleRpcError(error, getAppEndpointKey);
      if (response.code === 403) {
        return await callbackFunction(params);
      }
      return {
        error: await handleRpcError(error, getAppEndpointKey),
      };
    }
  }

  async joinChat(): ApiResponse<string> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, string>(
        {
          contextId: getContextId() || "",
          method: ClientMethod.JOIN_CHAT,
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
        return await this.handleError(response.error, {}, this.joinChat);
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
        return await this.handleError(response.error, {}, this.createChannel);
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
        return await this.handleError(response.error, {}, this.getChannels);
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
        return await this.handleError(response.error, {}, this.getAllChannelsSearch);
      }
      return {
        data: response?.result.output as Channels,
        error: null,
      };
    } catch (error) {
      console.error("getAllChannelsSearch failed:", error);
      let errorMessage = "An unexpected error occurred during getAllChannelsSearch";
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
        return await this.handleError(response.error, {}, this.getChannelInfo);
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
        return await this.handleError(
          response.error,
          {},
          this.getChannelMembers
        );
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
        return await this.handleError(response.error, {}, this.inviteToChannel);
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

  async getNonMemberUsers(props: GetNonMemberUsersProps): ApiResponse<UserId[]> {
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
        return await this.handleError(response.error, {}, this.getNonMemberUsers);
      }
      return {
        data: response?.result.output as UserId[],
        error: null,
      };
    } catch (error) {
      console.error("getNonMemberUsers failed:", error);
      let errorMessage = "An unexpected error occurred during getNonMemberUsers";
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
        return await this.handleError(response.error, {}, this.joinChannel);
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
        return await this.handleError(response.error, {}, this.leaveChannel);
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
          contextId: getContextId() || "",
          method: ClientMethod.GET_MESSAGES,
          argsJson: {
            group: props.group,
            limit: props.limit,
            offset: props.offset,
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
        return await this.handleError(response.error, {}, this.getMessages);
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
        return await this.handleError(response.error, {}, this.sendMessage);
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
}
