import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useContextGroup, useMero } from "@calimero-apps/cloud";
import { publishMemberName, useMemberNames } from "@calimero-apps/names";
import type { ArenaView, FighterView } from "./generated/MeroKombatClient";

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

/** How long the name field must sit still before it is published namespace-wide. */
const PUBLISH_DELAY_MS = 800;

/**
 * A corner's label: the name given in this arena, else the name its holder set
 * for the whole namespace, else a short id.
 *
 * The contract's `Fighter` counts as no name: it is what `sit` and `join` store
 * for a blank field, so someone who named themselves anywhere else on the
 * namespace would otherwise fight here as `Fighter`.
 */
export function cornerLabel(
  corner: FighterView,
  displayName: (account: string, appName?: string | null) => string,
): string {
  const given = corner.name.trim();
  return given && given !== DEFAULT_NAME ? given : displayName(corner.member, given);
}

/**
 * The arena with both corners named, and the player's own name kept in step
 * with the namespace.
 *
 * The namespace is the context's group: `ContextPicker` creates arenas directly
 * in the namespace (see `InviteCard`).
 */
export function useCornerNames(contextId: string, view: ArenaView | null) {
  const { admin } = useMero();
  const { groupId: namespaceId } = useContextGroup(contextId);
  const { nameOf, displayName } = useMemberNames(admin, namespaceId);

  const named = useMemo(() => {
    if (!view) return null;
    const corner = (f: FighterView): FighterView => (f.member ? { ...f, name: cornerLabel(f, displayName) } : f);
    return { ...view, p1: corner(view.p1), p2: corner(view.p2) };
  }, [view, displayName]);

  const me = view?.me ?? "";
  const selfName = me ? nameOf(me) : undefined;
  const [name, setName] = useState(storedName);

  // A blank name field adopts the name this person set for the namespace, so
  // they take a corner (and announce themselves) under it.
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

  /** Publish `next` namespace-wide. Best-effort: the arena name is what was asked for. */
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
