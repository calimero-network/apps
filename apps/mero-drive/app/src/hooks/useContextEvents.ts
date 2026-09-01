// Subscribe to merod SSE events for one or more contexts and invoke
// `onChange` whenever any event arrives. Drives live-refresh across
// the app surface (workspace switcher, folder tree, members panels,
// doc body, etc.) without polling.
//
// `useSubscription` from mero-react opens one EventSource per
// distinct contextId set, internally keyed on `JSON.stringify`, and
// fans events to all handlers. Multiple components subscribing to
// the same id set share a single connection — the dedupe happens at
// that layer, so this hook does not memoise the array itself; it
// just normalises and sorts the input so a re-render with the same
// content produces the same stringified key.
//
// Handler stability: pass a stable `onChange` (wrapped in
// `useCallback`) — mero-react reads the callback via ref so a fresh
// arrow each render does NOT disconnect the SSE socket, but the
// caller should still keep handler identity stable so the
// per-subscriber bookkeeping doesn't churn.

import { useCallback, useEffect, useRef } from 'react';
import {
  useSubscription,
  type SseEventData,
} from '@calimero-network/mero-react';

/** Normalise a context-id input (single id, array, or nullable) into a
 *  sorted, de-nulled string[]. Shared with useSyncStatus so both feed
 *  mero-react's per-id-set `useSubscription` an identical, stable key. */
export function normalizeContextIds(
  contextIds:
    | ReadonlyArray<string | null | undefined>
    | string
    | null
    | undefined,
): string[] {
  const ids: string[] = [];
  if (typeof contextIds === 'string') {
    if (contextIds.length > 0) ids.push(contextIds);
  } else if (Array.isArray(contextIds)) {
    for (const c of contextIds) {
      if (typeof c === 'string' && c.length > 0) ids.push(c);
    }
  }
  ids.sort();
  return ids;
}

export interface UseContextEventsOptions {
  /**
   * When true, `onChange` fires ONLY for events whose `event.contextId`
   * is one of `contextIds`. Default false (legacy behaviour: fire on
   * every delivered event, regardless of which context mutated).
   *
   * Use this for consumers that genuinely only care about *their own*
   * contexts' state mutations — most notably the workspace hook, which
   * only needs the registry context's dings and should ignore docs-box
   * dings from an open editor (otherwise every autosave triggers a full
   * workspace refetch + getGroupInfo fan-out).
   *
   * Do NOT enable this for consumers that rely on reacting to *any*
   * event because the signal they need (e.g. a governance membership
   * change) never dings a box they subscribe to — see useMemberCaps.
   */
  strict?: boolean;
  /**
   * Coalesce bursts: when > 0, `onChange` fires once `debounceMs` after the
   * LAST event in a burst, instead of once per event. A doc autosave fans
   * rapid state-DAG events across the shared socket; without this, every
   * non-strict subscriber (each folder row's caps/role hook) re-fetches per
   * event — an N-row RPC storm on every keystroke-batch. Debouncing keeps the
   * "react to any event" semantics while collapsing the storm to one refetch.
   * Trailing-edge only (a settled burst still triggers exactly one refetch).
   */
  debounceMs?: number;
}

export function useContextEvents(
  contextIds:
    | ReadonlyArray<string | null | undefined>
    | string
    | null
    | undefined,
  onChange: () => void,
  options?: UseContextEventsOptions,
): void {
  // Computing on every render is cheap (≤ a handful of strings) and lets
  // mero-react's JSON.stringify dedupe inside useSubscription do its job
  // without a redundant local memo layer.
  const ids = normalizeContextIds(contextIds);

  const strict = options?.strict ?? false;
  const debounceMs = options?.debounceMs ?? 0;
  // Stable, comparable key for the id set — context ids are hex
  // so a comma separator never collides. Used as the callback dep
  // (the `ids` array is a fresh reference each render) and to rebuild
  // the allow-set inside the handler without capturing the array.
  const idsKey = ids.join(',');

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any pending debounced fire on unmount so a settled timer can't
  // call onChange after the consumer is gone.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handler = useCallback(
    (event: SseEventData) => {
      if (strict) {
        const allowed = idsKey.length > 0 ? idsKey.split(',') : [];
        if (!event || !allowed.includes(event.contextId)) return;
      }
      if (debounceMs <= 0) {
        onChange();
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        onChange();
      }, debounceMs);
    },
    [onChange, strict, idsKey, debounceMs],
  );

  useSubscription(ids, handler);
}
