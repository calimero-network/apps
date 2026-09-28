const APPLE_UA = /Mac|iPhone|iPad/; // key hints name ⌘ only on Apple

/** The shortcut hints for a browser's user agent: ⌘ on Apple, Ctrl elsewhere. */
export function keyLabels(userAgent: string): {
  search: string;
  newTab: string;
} {
  return APPLE_UA.test(userAgent)
    ? { search: '⌘K', newTab: '⌘↵' }
    : { search: 'Ctrl K', newTab: 'Ctrl ↵' };
}

export const KEY_LABELS = keyLabels(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
);
