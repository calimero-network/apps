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
  GetCalendarEventsRequest,
  GetCalendarEventsResponse,
} from '../clientApi';

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

  async getCalendarEvents(): ApiResponse<GetCalendarEventsResponse> {
    try {
      const { publicKey, contextId, config, error } =
        prepareAuthenticatedRequestConfig();
      if (error) {
        return { error };
      }

      const response = await getJsonRpcClient().execute<
        GetCalendarEventsRequest,
        GetCalendarEventsResponse
      >(
        {
          contextId: contextId,
          method: ClientMethod.GET_CALENDAR_EVENTS,
          argsJson: {},
          executorPublicKey: publicKey,
        },
        config,
      );
      if (response?.error) {
        return await this.handleError(
          response.error,
          {},
          this.getCalendarEvents,
        );
      }

      return {
        data: response.result.output as GetCalendarEventsResponse,
        error: null,
      };
    } catch (error) {
      console.error('getCalendarEvents failed:', error);
      let errorMessage = 'An unexpected error occurred during getCount';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
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
