import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { deviceKeeper } from '../lib/deviceKey';

/** Whether this browser's device key is unlocked, reactively. */
export function useDeviceUnlocked(): boolean {
  return useSyncExternalStore(
    (fn) => deviceKeeper.onChange(fn),
    () => deviceKeeper.isUnlocked,
  );
}

const IDLE_KEY = 'mero-pass:auto-lock-minutes';
export const AUTO_LOCK_CHOICES = [1, 5, 15, 60] as const;
const DEFAULT_MINUTES = 5;

function readMinutes(): number {
  try {
    const v = Number(localStorage.getItem(IDLE_KEY));
    return AUTO_LOCK_CHOICES.includes(v as never) ? v : DEFAULT_MINUTES;
  } catch {
    return DEFAULT_MINUTES;
  }
}

/** The auto-lock delay, persisted per browser. */
export function useAutoLockMinutes(): [number, (m: number) => void] {
  const [minutes, setMinutes] = useState(readMinutes);
  const set = useCallback((m: number) => {
    setMinutes(m);
    try {
      localStorage.setItem(IDLE_KEY, String(m));
    } catch {
      // Private window: the choice lasts for this tab only.
    }
  }, []);
  return [minutes, set];
}

/**
 * Lock the device key after `minutes` without input, and when the tab has
 * been hidden for as long. Locking drops every vault key held in memory; the
 * next vault read asks to unlock again.
 */
export function useAutoLock(minutes: number): void {
  useEffect(() => {
    const ms = minutes * 60_000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => deviceKeeper.lock(), ms);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [minutes]);
}
