import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clearAppId = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useApplicationId', () => ({
  clearApplicationIdCache: clearAppId,
}));

import { copySecret } from '../lib/clipboard';
import { deviceKeeper } from '../lib/deviceKey';
import { THEME_KEY } from '../lib/theme';
import { signOut } from './signOut';

describe('signOut', () => {
  let clipboard: string;

  beforeEach(() => {
    clipboard = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (v: string) => {
          clipboard = v;
        }),
        readText: vi.fn(async () => clipboard),
      },
    });
    clearAppId.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('locks the vault keys, forgets the app selection, then ends the session', () => {
    const order: string[] = [];
    vi.spyOn(deviceKeeper, 'lock').mockImplementation(() => {
      order.push('lock');
    });
    clearAppId.mockImplementation(() => order.push('app-id'));

    signOut(() => order.push('logout'));

    expect(order).toEqual(['lock', 'app-id', 'logout']);
  });

  it('leaves nothing that opens a vault: the device key is locked by the time logout runs', () => {
    let unlockedAtLogout: boolean | null = null;
    signOut(() => {
      unlockedAtLogout = deviceKeeper.isUnlocked;
    });
    expect(unlockedAtLogout).toBe(false);
  });

  it('clears a copied password now, not 30 seconds later', async () => {
    vi.useFakeTimers();
    try {
      await copySecret('hunter2-the-password');
      expect(clipboard).toBe('hunter2-the-password');

      signOut(() => {});
      // The read-back and the write are promises; let them settle without
      // advancing the 30-second timer.
      await vi.advanceTimersByTimeAsync(0);
      expect(clipboard).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the light/dark choice: it belongs to the browser, not the account', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    signOut(() => {});
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });
});
