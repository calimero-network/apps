const APPLE_UA = /Mac|iPhone|iPad/; // key hints name ⌘ only on Apple
const APPLE_KEYS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧' };
const OTHER_KEYS: Record<string, string> = { Mod: 'Ctrl' };
const USER_AGENT = typeof navigator === 'undefined' ? '' : navigator.userAgent;

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

export const KEY_LABELS = {
  search: shortcutLabel('Mod-K'),
  newTab: shortcutLabel('Mod-↵'),
};
