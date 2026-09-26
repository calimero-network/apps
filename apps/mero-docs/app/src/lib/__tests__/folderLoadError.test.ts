import { describe, expect, it } from 'vitest';
import { folderLoadErrorMessage } from '../folderLoadError';

describe('folderLoadErrorMessage', () => {
  it('maps a permission-flavored error to plain access copy', () => {
    const msg = folderLoadErrorMessage(new Error('caller is not a member of this group'));
    expect(msg).toBe("You don't have access to this workspace's folders.");
  });

  it('maps a connection-flavored error to plain retry copy', () => {
    const msg = folderLoadErrorMessage(new Error('fetch failed: HTTP 503'));
    expect(msg).toBe("Couldn't reach your node. Check your connection and try again.");
  });

  it('falls back to a generic message for anything else, never the raw text', () => {
    const msg = folderLoadErrorMessage(new Error('registry context has no owned identity'));
    expect(msg).toBe("Couldn't load your folders. Try refreshing the page.");
    expect(msg).not.toMatch(/registry|context|identity/i);
  });
});
