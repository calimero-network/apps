import { HTTPError } from '@calimero-network/mero-js';
import { describe, expect, it } from 'vitest';
import { folderLoadErrorMessage } from '../folderLoadError';

const ACCESS = "You don't have access to this workspace's folders.";
const CONNECTION = "Couldn't reach your node. Check your connection and try again.";
const GENERIC = "Couldn't load your folders. Try refreshing the page.";

const httpError = (status: number) =>
  new HTTPError(status, 'x', 'http://node/admin-api', new Headers());

describe('folderLoadErrorMessage', () => {
  it.each([401, 403])('maps HTTP %i to plain access copy', (status) => {
    expect(folderLoadErrorMessage(httpError(status))).toBe(ACCESS);
  });

  it.each([0, 500, 503])('maps HTTP %i to plain retry copy', (status) => {
    expect(folderLoadErrorMessage(httpError(status))).toBe(CONNECTION);
  });

  it('maps a failed fetch (TypeError) to plain retry copy', () => {
    expect(folderLoadErrorMessage(new TypeError('Failed to fetch'))).toBe(CONNECTION);
  });

  it('ignores the wording of an untyped error', () => {
    expect(folderLoadErrorMessage(new Error('permission denied: network timeout'))).toBe(GENERIC);
  });

  it('falls back to generic copy for other HTTP statuses', () => {
    expect(folderLoadErrorMessage(httpError(404))).toBe(GENERIC);
  });
});
