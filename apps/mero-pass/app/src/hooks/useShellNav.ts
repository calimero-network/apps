import { createContext, useContext } from 'react';

/**
 * What a page can put in the rail, and how it closes the phone drawer.
 *
 * `slot` is an element inside the rail (or inside the open drawer on a phone)
 * that a page portals its own navigation into — the vault's categories, for
 * one. It is null on a phone while the drawer is shut, which is the page's cue
 * to render that navigation inline instead. Exactly one of the two is ever
 * mounted, so every test id in it exists once.
 */
export interface ShellNav {
  slot: HTMLElement | null;
  closeNav: () => void;
}

export const ShellNavContext = createContext<ShellNav>({
  slot: null,
  closeNav: () => {},
});

export function useShellNav(): ShellNav {
  return useContext(ShellNavContext);
}
