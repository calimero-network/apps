import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContextGroup, useMero } from "@calimero-apps/cloud";
import { publishMemberName, useMemberNames } from "@calimero-apps/names";
import type { SeatView, TableView } from "./generated/MeroChessClient";
import { rememberName, storedName } from "./useChess";

/** What the contract files a player under when they gave no name. */
export const DEFAULT_NAME = "Guest";

/** How long the name field must sit still before it is published namespace-wide. */
const PUBLISH_DELAY_MS = 800;

/**
 * A seat's label: the name given at this table, else the name its holder set
 * for the whole namespace, else a short id.
 *
 * The contract's `Guest` counts as no name: it is what `sit` and `join` store
 * for a blank field, so a player who named themselves anywhere else on the
 * namespace would otherwise sit here as a Guest.
 */
export function seatLabel(
  seat: SeatView,
  displayName: (account: string, appName?: string | null) => string,
): string {
  const given = seat.name.trim();
  return given && given !== DEFAULT_NAME ? given : displayName(seat.member, given);
}

/**
 * The table with every seat named, and the player's own name kept in step with
 * the namespace.
 *
 * The namespace is the context's group: `ContextPicker` creates tables directly
 * in the namespace (see `InviteCard`).
 */
export function useSeatNames(contextId: string, view: TableView | null) {
  const { admin } = useMero();
  const { groupId: namespaceId } = useContextGroup(contextId);
  const { nameOf, displayName } = useMemberNames(admin, namespaceId);

  const named = useMemo(() => {
    if (!view) return null;
    const seat = (s: SeatView): SeatView => (s.member ? { ...s, name: seatLabel(s, displayName) } : s);
    return { ...view, white: seat(view.white), black: seat(view.black) };
  }, [view, displayName]);

  const me = view?.me ?? "";
  const selfName = me ? nameOf(me) : undefined;
  const [name, setName] = useState(storedName);

  // A blank name field adopts the name this person set for the namespace, so
  // they sit (and announce themselves) under it rather than as a Guest.
  //
  // Every instance fills its own field: the first to see the name stores it,
  // and an instance that finds it already stored still takes it rather than
  // returning with its field blank.
  useEffect(() => {
    if (!selfName) return;
    const stored = storedName();
    if (!stored) rememberName(selfName);
    setName((current) => current || stored || selfName);
  }, [selfName]);

  /** Publish `next` namespace-wide. Best-effort: the table name is what was asked for. */
  const publish = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!admin || !namespaceId || !me || !trimmed || trimmed === selfName) return;
      void publishMemberName(admin, namespaceId, me, trimmed).catch(() => undefined);
    },
    [admin, namespaceId, me, selfName],
  );

  // The field announces on every keystroke; the namespace record is written
  // once the typing stops, not once per letter.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const changeName = useCallback(
    (next: string) => {
      setName(next);
      rememberName(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => publish(next), PUBLISH_DELAY_MS);
    },
    [publish],
  );

  return { view: named, name, changeName, publish };
}
