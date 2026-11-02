import { HTTPError } from '@/calimero/errors';

// The raw load error is implementation detail, so callers log it and show this plain copy instead.

const ACCESS_STATUSES = new Set([401, 403]); // node refused this caller

export function folderLoadErrorMessage(error: Error): string {
  if (error instanceof HTTPError && ACCESS_STATUSES.has(error.status)) {
    return "You don't have access to this workspace's folders.";
  }
  const unreachable =
    error instanceof TypeError ||
    (error instanceof HTTPError &&
      error.status >= 500);
  if (unreachable) {
    return "Couldn't reach Calimero. Check your connection and try again.";
  }
  return "Couldn't load your folders. Try refreshing the page.";
}
