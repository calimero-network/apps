// Tiny SSR-safe localStorage-backed state hook. Values are
// JSON-serialized. Writing `null` removes the key.
//
// Used by useDriveWorkspace to persist namespace selection across
// reloads without adopting a larger state-management library.

import { useCallback, useState } from 'react';

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        if (v === null || v === undefined) {
          window.localStorage.removeItem(key);
        } else {
          window.localStorage.setItem(key, JSON.stringify(v));
        }
      } catch {
        // storage unavailable / quota — state is already updated in
        // memory, so the UI is correct even if the persist failed.
      }
    },
    [key],
  );

  return [value, set];
}
