import {
  JsonRpcClient,
  WsSubscriptionsClient,
  RpcError,
  handleRpcError,
  getAppEndpointKey,
  // prepareAuthenticatedRequestConfig, 
} from '@calimero-network/calimero-client';
import { ClientApi } from '../clientApi';
// import { ClientMethod } from '../clientApi'; 

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
        error: error,
      };
    }
    return {
      error: error,
    };
  }

  // Future MeroDocs API methods will be implemented here
}
