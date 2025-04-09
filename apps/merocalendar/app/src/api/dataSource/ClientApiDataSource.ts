import {
  ApiResponse,
  JsonRpcClient,
  WsSubscriptionsClient,
  RpcError,
  handleRpcError,
  getAppEndpointKey,
  prepareAuthenticatedRequestConfig,
} from '@calimero-network/calimero-client';
import {
  ClientApi,
  ClientMethod,
  CreateEventResponse,
  DeleteEventResponse,
  GetEventsResponse,
  UpdateEventResponse,
} from '../clientApi';
import { IEventCreate, TPartialEvent } from '../../types/event';

export function getJsonRpcClient() {
  const appEndpointKey = getAppEndpointKey();
  if (!appEndpointKey) {
    throw new Error(
      'Application endpoint key is missing. Please check your configuration.',
    );
  }
  return new JsonRpcClient(appEndpointKey, '/jsonrpc');
}

export function getWsSubscriptionsClient() {
  const appEndpointKey = getAppEndpointKey();
  if (!appEndpointKey) {
    throw new Error(
      'Application endpoint key is missing. Please check your configuration.',
    );
  }
  return new WsSubscriptionsClient(appEndpointKey, '/ws');
}

export class ClientApiDataSource implements ClientApi {
  private async handleError(
    error: RpcError,
    params: any,
    callbackFunction: any,
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

  async getEvents(): ApiResponse<GetEventsResponse> {
    try {
      const { publicKey, contextId, config, error } =
        prepareAuthenticatedRequestConfig();
      if (error) {
        return { error };
      }

      const response = await getJsonRpcClient().execute<any, GetEventsResponse>(
        {
          contextId: contextId,
          method: ClientMethod.GET_EVENTS,
          argsJson: {},
          executorPublicKey: publicKey,
        },
        config
      );
      if (response?.error) {
        return await this.handleError(response.error, {}, this.getEvents);
      }

      return {
        data: { response },
        error: null,
      };
    } catch (error) {
      console.error("getEvents failed:", error);
      let errorMessage = "An unexpected error occurred during getEvents";
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

  async createEvent(event: IEventCreate): ApiResponse<CreateEventResponse> {
    try {
      const { publicKey, contextId, config, error } =
        prepareAuthenticatedRequestConfig();

      if (error) {
        return { error };
      }
      const response = await getJsonRpcClient().execute<
        any,
        CreateEventResponse
      >(
        {
          contextId: contextId,
          method: ClientMethod.CREATE_EVENT,
          argsJson: event,
          executorPublicKey: publicKey,
        },
        config
      );
      if (response?.error) {
        return await this.handleError(response.error, {}, this.createEvent);
      }

      return {
        data: Number(response?.result?.output) ?? null,
        error: null,
      };
    } catch (error) {
      console.error("createEvent failed:", error);
      let errorMessage = "An unexpected error occurred during createEvent";
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

  async deleteEvent(eventId: string): ApiResponse<DeleteEventResponse> {
    try {
      const { publicKey, contextId, config, error } =
        prepareAuthenticatedRequestConfig();
      if (error) {
        return { error };
      }

      const response = await getJsonRpcClient().execute<
        any,
        DeleteEventResponse
      >(
        {
          contextId: contextId,
          method: ClientMethod.DELETE_EVENT,
          argsJson: eventId,
          executorPublicKey: publicKey,
        },
        config
      );
      if (response?.error) {
        return await this.handleError(response.error, {}, this.deleteEvent);
      }

      return {
        data: Number(response?.result?.output) ?? null,
        error: null,
      };
    } catch (error) {
      console.error("deleteEvent failed:", error);
      let errorMessage = "An unexpected error occurred during deleteEvent";
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

  async updateEvent(
    eventId: string,
    eventData: TPartialEvent
  ): ApiResponse<UpdateEventResponse> {
    try {
      const { publicKey, contextId, config, error } =
        prepareAuthenticatedRequestConfig();

      if (error) {
        return { error };
      }
      const response = await getJsonRpcClient().execute<
        any,
        UpdateEventResponse
      >(
        {
          contextId: contextId,
          method: ClientMethod.UPDATE_EVENT,
          argsJson: { eventId, eventData },
          executorPublicKey: publicKey,
        },
        config
      );
      if (response?.error) {
        return await this.handleError(response.error, {}, this.updateEvent);
      }

      return {
        data: Number(response?.result?.output) ?? null,
        error: null,
      };
    } catch (error) {
      console.error("updateEvent failed:", error);
      let errorMessage = "An unexpected error occurred during updateEvent";
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
