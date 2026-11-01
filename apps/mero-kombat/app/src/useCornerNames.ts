import { useCallback, useMemo, useState } from "react";
import type { ArenaView, FighterView } from "./kombat";

/** Where a player's chosen display name lives between visits. */
const NAME_KEY = "mero-kombat:name";

export function storedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* a forgotten name is a smaller problem than a page that will not load */
  }
}

/** What the contract files a fighter under when they gave no name. */
export const DEFAULT_NAME = "Fighter";

/** `head…tail` of an account id, so two can be told apart at a glance. */
export function shortAccount(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/**
 * A corner's label: the name given in this arena, else a short account id.
 *
 * The contract's `Fighter` counts as no name: it is what `sit` and `join`
 * store for a blank field. (v1 fell back to the name its holder set for the
 * whole namespace, through `@calimero-apps/names`; an org has no such record
 * yet, so the account id stands in.)
 */
export function cornerLabel(corner: FighterView): string {
  const given = corner.name.trim();
  return given && given !== DEFAULT_NAME ? given : shortAccount(corner.member);
}

/** The arena with both corners named, and the player's own name field. */
export function useCornerNames(view: ArenaView | null) {
  const named = useMemo(() => {
    if (!view) return null;
    const corner = (f: FighterView): FighterView => (f.member ? { ...f, name: cornerLabel(f) } : f);
    return { ...view, p1: corner(view.p1), p2: corner(view.p2) };
  }, [view]);

  const [name, setName] = useState(storedName);
  const changeName = useCallback((next: string) => {
    setName(next);
    rememberName(next);
  }, []);

  return { view: named, name, changeName };
}
