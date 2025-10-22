import type { ApiResponse } from "@calimero-network/calimero-client";

/**
 * API Error type
 */
export interface ApiError {
  code: number;
  message: string;
}

/**
 * Options for handling API calls
 */
export interface ApiCallOptions<T> {
  /** Callback to execute on error */
  onError?: (error: ApiError) => void;
  /** Callback to execute on success */
  onSuccess?: (data: T) => void;
  /** Whether to log errors to console (default: true) */
  logErrors?: boolean;
}

/**
 * Standardized API call handler with consistent error handling
 * 
 * @example
 * const result = await handleApiCall(
 *   () => apiClient.getChannels(),
 *   { onError: (err) => console.error(err) }
 * );
 */
export async function handleApiCall<T>(
  apiCall: () => Promise<ApiResponse<T>>,
  options: ApiCallOptions<T> = {}
): Promise<T | null> {
  const { onError, onSuccess, logErrors = true } = options;
  
  try {
    const response = await apiCall();
    
    if (response.error) {
      if (logErrors) {
        console.error('API call failed:', response.error);
      }
      const apiError: ApiError = {
        code: response.error.code || 500,
        message: response.error.message || "Unknown error",
      };
      onError?.(apiError);
      return null;
    }
    
    if (response.data) {
      onSuccess?.(response.data);
      return response.data;
    }
    
    return null;
  } catch (error) {
    if (logErrors) {
      console.error('API call exception:', error);
    }
    
    const apiError: ApiError = {
      code: 500,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    };
    
    onError?.(apiError);
    return null;
  }
}

/**
 * Helper to safely execute an async function with error handling
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  fallback: T,
  errorMessage?: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (errorMessage) {
      console.error(errorMessage, error);
    }
    return fallback;
  }
}

