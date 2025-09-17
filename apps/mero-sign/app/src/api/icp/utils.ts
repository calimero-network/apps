import { BackendResult, BackendError } from './types';

/**
 * Utility function to handle backend results
 */
export const handleBackendResult = <T>(result: BackendResult<T>): T => {
  if ('Ok' in result) {
    return result.Ok;
  } else {
    const errorKey = Object.keys(result.Err)[0];
    const errorValue = result.Err[errorKey];
    const errorMessage = errorValue || errorKey;
    throw new Error(`Backend error: ${errorMessage}`);
  }
};

/**
 * Utility function to safely handle backend results without throwing
 */
export const safeHandleBackendResult = <T>(
  result: BackendResult<T>,
): { success: boolean; data?: T; error?: string } => {
  if ('Ok' in result) {
    return { success: true, data: result.Ok };
  } else {
    const errorKey = Object.keys(result.Err)[0];
    const errorValue = result.Err[errorKey];
    const errorMessage = errorValue || errorKey;
    return { success: false, error: errorMessage };
  }
};

/**
 * Type guard to check if a backend result is successful
 */
export const isBackendSuccess = <T>(
  result: BackendResult<T>,
): result is { Ok: T } => {
  return 'Ok' in result;
};

/**
 * Type guard to check if a backend result is an error
 */
export const isBackendError = <T>(
  result: BackendResult<T>,
): result is { Err: BackendError } => {
  return 'Err' in result;
};

/**
 * Extract error message from backend error
 */
export const getBackendErrorMessage = (error: BackendError): string => {
  const errorKey = Object.keys(error)[0];
  const errorValue = error[errorKey];
  return errorValue || errorKey;
};

/**
 * Convert bigint timestamps to JavaScript Date objects
 */
export const bigintToDate = (timestamp: bigint): Date => {
  // Convert nanoseconds to milliseconds
  return new Date(Number(timestamp / 1000000n));
};

/**
 * Convert JavaScript Date to bigint timestamp (nanoseconds)
 */
export const dateToBigint = (date: Date): bigint => {
  // Convert milliseconds to nanoseconds
  return BigInt(date.getTime()) * 1000000n;
};

/**
 * Validate required environment variables for ICP integration
 */
export const validateEnvironment = (): void => {
  const network = import.meta.env.VITE_DFX_NETWORK;
  const registryCanisterId = import.meta.env.VITE_MERODOCS_REGISTRY_CANISTER_ID;
  const llmChatbotCanisterId = import.meta.env.VITE_LLM_CHATBOT_CANISTER_ID;

  if (!network) {
    console.warn('⚠️ VITE_DFX_NETWORK not set, defaulting to local');
  }

  if (!registryCanisterId) {
    throw new Error(
      '❌ VITE_BACKEND_CANISTER_ID (MeroDocs Registry) is required but not set in environment variables',
    );
  }

  if (!llmChatbotCanisterId) {
    throw new Error(
      '❌ VITE_LLM_CHATBOT_CANISTER_ID is required but not set in environment variables',
    );
  }

  console.log(`✅ Environment configured for ${network || 'local'} network`);
  console.log(`✅ MeroDocs Registry Canister ID: ${registryCanisterId}`);
  console.log(`✅ LLM Chatbot Canister ID: ${llmChatbotCanisterId}`);
};

/**
 * Get current network configuration
 */
export const getNetworkConfig = () => {
  const network = import.meta.env.VITE_DFX_NETWORK || 'local';
  const registryCanisterId = import.meta.env.VITE_MERODOCS_REGISTRY_CANISTER_ID; // MeroDocs Registry
  const llmChatbotCanisterId = import.meta.env.VITE_LLM_CHATBOT_CANISTER_ID;
  const isMainnet = network === 'ic';

  return {
    network,
    registryCanisterId,
    llmChatbotCanisterId,
    isMainnet,
    hostUrl: isMainnet ? 'https://icp-api.io' : 'http://127.0.0.1:4943',
    identityProvider: isMainnet
      ? 'https://identity.ic0.app'
      : `http://${import.meta.env.VITE_INTERNET_IDENTITY_CANISTER_ID || 'be2us-64aaa-aaaaa-qaabq-cai'}.localhost:4943`,
  };
};
