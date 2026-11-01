import { useCallback, useMemo, useState } from "react";
import type { SeatView, TableView } from "./chess";
import { rememberName, storedName } from "./useChess";

/** What the contract files a player under when they gave no name. */
export const DEFAULT_NAME = "Guest";

/** `head…tail` of an account id, so two can be told apart at a glance. */
export function shortAccount(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/**
 * A seat's label: the name given at this table, else a short account id.
 *
 * The contract's `Guest` counts as no name: it is what `sit` and `join` store
 * for a blank field. (v1 fell back to the name its holder set for the whole
 * namespace, through `@calimero-apps/names`; an organization has no such record
 * yet, so the account id stands in.)
 */
export function seatLabel(seat: SeatView): string {
  const given = seat.name.trim();
  return given && given !== DEFAULT_NAME ? given : shortAccount(seat.member);
}

/** The table with both seats named, and the player's own name field. */
export function useSeatNames(view: TableView | null) {
  const named = useMemo(() => {
    if (!view) return null;
    const seat = (s: SeatView): SeatView => (s.member ? { ...s, name: seatLabel(s) } : s);
    return { ...view, white: seat(view.white), black: seat(view.black) };
  }, [view]);

  const [name, setName] = useState(storedName);
  const changeName = useCallback((next: string) => {
    setName(next);
    rememberName(next);
  }, []);

  return { view: named, name, changeName };
}
