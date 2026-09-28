const APPLE_UA = /Mac|iPhone|iPad/; // key hints name ⌘ only on Apple
const APPLE_KEYS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
const OTHER_KEYS: Record<string, string> = { Mod: 'Ctrl' };
const USER_AGENT = typeof navigator === 'undefined' ? '' : navigator.userAgent;

/** The shortcut hints for a browser's user agent: ⌘ on Apple, Ctrl elsewhere. */
export function keyLabels(userAgent: string): {
  search: string;
  newTab: string;
} {
  return APPLE_UA.test(userAgent)
    ? { search: '⌘K', newTab: '⌘↵' }
    : { search: 'Ctrl K', newTab: 'Ctrl ↵' };
}

export const KEY_LABELS = keyLabels(USER_AGENT);

/** A `Mod-Alt-1` style shortcut as one hint: `⌘⌥1` on Apple, `Ctrl Alt 1` elsewhere. */
export function shortcutLabel(
  shortcut: string,
  userAgent = USER_AGENT,
): string {
  const apple = APPLE_UA.test(userAgent);
  const names = apple ? APPLE_KEYS : OTHER_KEYS;
  return shortcut
    .split('-')
    .map((key) => names[key] ?? (key.length === 1 ? key.toUpperCase() : key))
    .join(apple ? '' : ' ');
}
