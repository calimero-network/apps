import { useCallback, useSyncExternalStore } from 'react';

/** Whether a CSS media query matches right now, following changes. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Below this width the rail gives way to a drawer opened from the top bar. */
export const NARROW_QUERY = '(max-width: 940px)';
