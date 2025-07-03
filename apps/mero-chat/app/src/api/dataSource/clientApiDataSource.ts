import {
  type ApiResponse,
  JsonRpcClient,
  WsSubscriptionsClient,
  type RpcError,
  handleRpcError,
  getAppEndpointKey,
  getAuthConfig,
} from "@calimero-network/calimero-client";
import {
  type Channels,
  type ClientApi,
  ClientMethod,
  type CreateChannelProps,
  type CreateChannelResponse,
  type GetChannelMembersProps,
  type GetMessagesProps,
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

  async getChannels(): ApiResponse<Channels> {
    try {
      const config = getAuthConfig();

      if (!config || !config.contextId || !config.executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: "Authentication configuration not found",
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, Channels>(
        {
          contextId: config.contextId,
          method: ClientMethod.GET_CHANNELS,
          argsJson: {},
          executorPublicKey: config.executorPublicKey,
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

  async createChannel(
    props: CreateChannelProps
  ): ApiResponse<CreateChannelResponse> {
    try {
      const config = getAuthConfig();

      if (!config || !config.contextId || !config.executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: "Authentication configuration not found",
          },
        };
      }

      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        CreateChannelResponse
      >(
        {
          contextId: config.contextId,
          method: ClientMethod.CREATE_CHANNEL,
          argsJson: {
            channel: props.channel,
            channel_type: props.channel_type,
            read_only: props.read_only,
            moderators: props.moderators,
            links_allowed: props.links_allowed,
            created_at: props.created_at,
          },
          executorPublicKey: config.executorPublicKey,
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

  async getChannelMembers(
    props: GetChannelMembersProps
  ): ApiResponse<UserId[]> {
    try {
      const config = getAuthConfig();

      if (!config || !config.contextId || !config.executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: "Authentication configuration not found",
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, UserId[]>(
        {
          contextId: config.contextId,
          method: ClientMethod.GET_CHANNEL_MEMBERS,
          argsJson: {
            channel: props.channel,
          },
          executorPublicKey: config.executorPublicKey,
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
  async getMessages(props: GetMessagesProps): ApiResponse<Message[]> {
    try {
      const config = getAuthConfig();

      if (!config || !config.contextId || !config.executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: "Authentication configuration not found",
          },
        };
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await getJsonRpcClient().execute<any, Message[]>(
        {
          contextId: config.contextId,
          method: ClientMethod.GET_MESSAGES,
          argsJson: {
            group: props.group,
            limit: props.limit,
            offset: props.offset,
          },
          executorPublicKey: config.executorPublicKey,
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
        data: response?.result.output as Message[],
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
      const config = getAuthConfig();

      if (!config || !config.contextId || !config.executorPublicKey) {
        return {
          data: null,
          error: {
            code: 500,
            message: "Authentication configuration not found",
          },
        };
      }

      const response = await getJsonRpcClient().execute<
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        any,
        Message
      >(
        {
          contextId: config.contextId,
          method: ClientMethod.CREATE_CHANNEL,
          argsJson: {
            group: props.group,
            message: props.message,
            timestamp: props.timestamp,
          },
          executorPublicKey: config.executorPublicKey,
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
