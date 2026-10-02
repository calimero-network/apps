/**
 * Which workspace to show, when nobody has picked one.
 *
 * The namespace list comes back from `useNamespacesForApplication`, which reads
 * `[]` until the node answers, and again every time its scope changes (the
 * application id is resolved after the first render). An empty list on those
 * renders means "not asked yet", not "this node holds no workspaces", and
 * acting on it is how a workspace a page arrived with got thrown away:
 *
 *   1. the SSO callback resolves its context's namespace and selects it;
 *   2. the list is still `[]`, so the default rule clears the selection;
 *   3. the list arrives, and the default rule enters `namespaces[0]`.
 *
 * On a node holding several workspaces, (3) is whichever sorts first, so the
 * page silently showed a different workspace from the one it was handed. A
 * reload with a persisted pick lost it the same way. So the default rule only
 * runs on a list that has answered for the current scope, and an explicit pick
 * (the switcher, a create or join, an SSO handoff) is never overridden by it.
 */
import { useEffect, useRef, useState } from 'react';

export interface ActiveNsInput {
  namespaces: readonly { namespaceId: string }[];
  /** The list has answered for the current scope. */
  listed: boolean;
  activeNs: string | null;
  /** The current workspace was picked explicitly, not defaulted. */
  pinned: boolean;
  /** An SSO callback context's namespace is still being looked up. */
  resolvingCallback: boolean;
}

export type ActiveNsDecision =
  | { kind: 'keep' }
  /** Switch to `id`, and drop the persisted pick if `dropPersisted`. */
  | { kind: 'set'; id: string | null; dropPersisted: boolean };

const KEEP: ActiveNsDecision = { kind: 'keep' };

export function decideActiveNs(input: ActiveNsInput): ActiveNsDecision {
  const { namespaces, listed, activeNs, pinned, resolvingCallback } = input;
  if (pinned || resolvingCallback || !listed) return KEEP;
  if (namespaces.length === 0) {
    return activeNs ? { kind: 'set', id: null, dropPersisted: true } : KEEP;
  }
  if (activeNs && namespaces.some((n) => n.namespaceId === activeNs)) return KEEP;
  // A cold-start default, held in memory only: explicit picks are what persist.
  return { kind: 'set', id: namespaces[0].namespaceId, dropPersisted: !!activeNs };
}

/**
 * True once a fetch has finished without error since `scope` last changed.
 *
 * `loading` alone cannot say this: it reads `false` on the render a new scope
 * arrives in, before that scope's fetch has started. So this waits for a
 * loading -> done transition that belongs to the current scope. A fetch already
 * in flight when the scope changes counts, because the resource drops the
 * stale fetch's result and its `loading` stays up until the new one finishes.
 */
export function useAnswered(loading: boolean, error: unknown, scope: readonly unknown[]): boolean {
  const [answered, setAnswered] = useState(false);
  const sawLoading = useRef(loading);
  useEffect(() => {
    sawLoading.current = loading;
    setAnswered(false);
  }, scope); // `loading` is read here, not tracked: only a scope change resets
  useEffect(() => {
    if (loading) {
      sawLoading.current = true;
      return;
    }
    if (sawLoading.current) setAnswered(!error);
  }, [loading, error]);
  return answered;
}
