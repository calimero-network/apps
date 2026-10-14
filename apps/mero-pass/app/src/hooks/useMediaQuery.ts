import { useSyncExternalStore } from 'react';

/** Below this the rail is gone and the top bar's menu button opens a drawer. */
export const NARROW_QUERY = '(max-width: 900px)';

/**
 * Whether `query` matches, reactively. False where `matchMedia` does not exist
 * (jsdom, a very old webview), which renders the wide layout.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {};
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () =>
      typeof window !== 'undefined' && !!window.matchMedia
        ? window.matchMedia(query).matches
        : false,
    () => false,
  );
}
