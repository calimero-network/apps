import { HTTPError } from '@calimero-network/mero-js';

// The raw load error is implementation detail, so callers log it and show this plain copy instead.

const ACCESS_STATUSES = new Set([401, 403]); // node refused this caller
const NETWORK_ERROR_STATUS = 0; // mero-js status when fetch itself failed

export function folderLoadErrorMessage(error: Error): string {
  if (error instanceof HTTPError && ACCESS_STATUSES.has(error.status)) {
    return "You don't have access to this workspace's folders.";
  }
  const unreachable =
    error instanceof TypeError ||
    (error instanceof HTTPError &&
      (error.status === NETWORK_ERROR_STATUS || error.status >= 500));
  if (unreachable) {
    return "Couldn't reach your node. Check your connection and try again.";
  }
  return "Couldn't load your folders. Try refreshing the page.";
}
