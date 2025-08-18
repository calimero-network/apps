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
