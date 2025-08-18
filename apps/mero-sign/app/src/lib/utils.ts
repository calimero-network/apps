import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generates an ICP document ID from context and document IDs
 */
export function generateIcpDocumentId(
  contextId: string,
  documentId: string,
): string {
  return `icp_${contextId}_${documentId}`;
}

/**
 * Formats a user ID for display (truncates long IDs)
 */
export function formatUserId(userId: string): string {
  if (userId.length <= 12) return userId;
  return `${userId.slice(0, 6)}...${userId.slice(-6)}`;
}

/**
 * Formats a timestamp for display with timezone
 */
export function formatTimestamp(timestamp: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(timestamp);
}
